/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { injectable, inject, postConstruct } from 'inversify';
import { Emitter, Event, Disposable, DisposableCollection } from '@theia/core';
import { StorageService, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { OutputPreferences } from './output-preferences';

@injectable()
export class OutputChannelManager implements FrontendApplicationContribution, Disposable {
    protected readonly channels = new Map<string, OutputChannel>();
    protected selectedChannelValue: OutputChannel | undefined;

    protected readonly channelDeleteEmitter = new Emitter<{ channelName: string }>();
    protected readonly channelAddedEmitter = new Emitter<OutputChannel>();
    protected readonly selectedChannelEmitter: Emitter<void> = new Emitter<void>();
    protected readonly listOrSelectionEmitter: Emitter<void> = new Emitter<void>();
    protected readonly channelLockedEmitter = new Emitter<OutputChannel>();
    readonly onChannelDelete = this.channelDeleteEmitter.event;
    readonly onChannelAdded = this.channelAddedEmitter.event;
    readonly onSelectedChannelChange = this.selectedChannelEmitter.event;
    readonly onListOrSelectionChange = this.listOrSelectionEmitter.event;
    readonly onLockChange = this.channelLockedEmitter.event;

    protected toDispose = new DisposableCollection();
    protected toDisposeOnChannelDeletion = new Map<string, DisposableCollection>();
    protected lockedChannels = new Set<string>();

    @inject(OutputPreferences)
    protected readonly preferences: OutputPreferences;

    @inject(StorageService)
    protected readonly storageService: StorageService;

    async onStart(): Promise<void> {
        const lockedChannels = await this.storageService.getData<Array<string>>('theia:output-channel-manager:lockedChannels');
        if (Array.isArray(lockedChannels)) {
            for (const channelName of lockedChannels) {
                this.lockedChannels.add(channelName);
            }
        }
    }

    onStop(): void {
        const lockedChannels = Array.from(this.channels.values()).filter(({ isLocked }) => isLocked).map(({ name }) => name);
        this.storageService.setData('theia:output-channel-manager:lockedChannels', lockedChannels);
    }

    @postConstruct()
    protected init(): void {
        this.toDispose.pushAll([
            this.channelDeleteEmitter,
            this.channelAddedEmitter,
            this.selectedChannelEmitter,
            this.listOrSelectionEmitter,
            this.channelLockedEmitter
        ]);
        this.getChannels().forEach(this.registerListener.bind(this));
        this.toDispose.push(this.onChannelAdded(channel => {
            this.listOrSelectionEmitter.fire(undefined);
            this.registerListener(channel);
        }));
        this.toDispose.push(this.onChannelDelete(event => {
            this.listOrSelectionEmitter.fire(undefined);
            if (this.selectedChannel && this.selectedChannel.name === event.channelName) {
                this.selectedChannel = this.getVisibleChannels()[0];
            }
        }));
    }

    protected registerListener(outputChannel: OutputChannel): void {
        const { name } = outputChannel;
        if (!this.selectedChannel) {
            this.selectedChannel = outputChannel;
        }
        let toDisposePerChannel = this.toDisposeOnChannelDeletion.get(name);
        if (!toDisposePerChannel) {
            toDisposePerChannel = new DisposableCollection();
            this.toDisposeOnChannelDeletion.set(name, toDisposePerChannel);
        }
        toDisposePerChannel.push(outputChannel);
        toDisposePerChannel.push(outputChannel.onVisibilityChange(event => {
            if (event.visible) {
                this.selectedChannel = outputChannel;
            } else if (outputChannel === this.selectedChannel) {
                this.selectedChannel = this.getVisibleChannels()[0];
            }
        }));
        toDisposePerChannel.push(outputChannel.onLockChange(() => this.channelLockedEmitter.fire(outputChannel)));
        if (this.lockedChannels.has(name)) {
            if (!outputChannel.isLocked) {
                outputChannel.toggleLocked();
            }
        }
    }

    getChannel(name: string): OutputChannel {
        const existing = this.channels.get(name);
        if (existing) {
            return existing;
        }
        const channel = new OutputChannel(name, this.preferences);
        this.channels.set(name, channel);
        this.channelAddedEmitter.fire(channel);
        return channel;
    }

    deleteChannel(name: string): void {
        const existing = this.channels.get(name);
        if (!existing) {
            console.warn(`Could not delete channel '${name}'. The channel does not exist.`);
            return;
        }
        this.channels.delete(name);
        const toDisposePerChannel = this.toDisposeOnChannelDeletion.get(name);
        if (toDisposePerChannel) {
            toDisposePerChannel.dispose();
        }
        this.channelDeleteEmitter.fire({ channelName: name });
    }

    getChannels(): OutputChannel[] {
        return Array.from(this.channels.values());
    }

    getVisibleChannels(): OutputChannel[] {
        return this.getChannels().filter(channel => channel.isVisible);
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    get selectedChannel(): OutputChannel | undefined {
        return this.selectedChannelValue;
    }

    set selectedChannel(channel: OutputChannel | undefined) {
        this.selectedChannelValue = channel;
        this.selectedChannelEmitter.fire(undefined);
        this.listOrSelectionEmitter.fire(undefined);
    }

    toggleScrollLock(channel: OutputChannel | undefined = this.selectedChannel): void {
        if (!channel) {
            console.warn(`Channel '${name}' does not exist.`);
            return;
        }
        channel.toggleLocked();
    }
}

export class OutputChannel implements Disposable {

    private readonly visibilityChangeEmitter = new Emitter<{ visible: boolean }>();
    private readonly lockedChangeEmitter = new Emitter<{ scrollLock: boolean }>();
    private readonly contentChangeEmitter = new Emitter<OutputChannel>();
    private readonly toDispose = new DisposableCollection();
    private lines: string[] = [];
    private currentLine: string | undefined;
    private visible: boolean = true;
    private locked: boolean = false;

    readonly onVisibilityChange: Event<{ visible: boolean }> = this.visibilityChangeEmitter.event;
    readonly onLockChange: Event<{ scrollLock: boolean }> = this.lockedChangeEmitter.event;
    readonly onContentChange: Event<OutputChannel> = this.contentChangeEmitter.event;

    constructor(readonly name: string, readonly preferences: OutputPreferences) {
        this.toDispose.pushAll([
            this.visibilityChangeEmitter,
            this.lockedChangeEmitter,
            this.contentChangeEmitter
        ]);
    }

    append(value: string): void {
        if (this.currentLine === undefined) {
            this.currentLine = value;
        } else {
            this.currentLine += value;
        }
        this.contentChangeEmitter.fire(this);
    }

    appendLine(line: string): void {
        if (this.currentLine !== undefined) {
            this.lines.push(this.currentLine + line);
            this.currentLine = undefined;
        } else {
            this.lines.push(line);
        }
        const maxChannelHistory = this.preferences['output.maxChannelHistory'];
        if (this.lines.length > maxChannelHistory) {
            this.lines.splice(0, this.lines.length - maxChannelHistory);
        }
        this.contentChangeEmitter.fire(this);
    }

    clear(): void {
        this.lines.length = 0;
        this.currentLine = undefined;
        this.contentChangeEmitter.fire(this);
    }

    setVisibility(visible: boolean): void {
        this.visible = visible;
        this.visibilityChangeEmitter.fire({ visible });
    }

    getLines(): string[] {
        if (this.currentLine !== undefined) {
            return [...this.lines, this.currentLine];
        } else {
            return this.lines;
        }
    }

    get isVisible(): boolean {
        return this.visible;
    }

    toggleLocked(): void {
        this.locked = !this.locked;
        this.lockedChangeEmitter.fire({ scrollLock: this.locked });
    }

    get isLocked(): boolean {
        return this.locked;
    }

    dispose(): void {
        this.toDispose.dispose();
    }

}
