/********************************************************************************
 * Copyright (C) 2019 Arm and others.
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

import { ContainerModule, inject, injectable } from 'inversify';
import { bindDynamicLabelProvider } from './label/sample-dynamic-label-provider-command-contribution';
import { bindSampleUnclosableView } from './view/sample-unclosable-view-contribution';
import { CommandRegistry, CommandContribution } from '@theia/core/';
import { OutputChannelManager } from '@theia/output/lib/common/output-channel';

export default new ContainerModule(bind => {
    bindDynamicLabelProvider(bind);
    bindSampleUnclosableView(bind);
    bind(CommandContribution).to(SampleOutputChannelsCommandContribution).inSingletonScope();
});

@injectable()
class SampleOutputChannelsCommandContribution implements CommandContribution {

    @inject(OutputChannelManager)
    private readonly ocm: OutputChannelManager;

    private timers = new Map<string, number>();

    registerCommands(commands: CommandRegistry): void {
        for (const channelName of ['one', 'two', 'three']) {
            const command = { id: `post-date-now-${channelName}`, label: `API Sample: Post Date.now() to the '${channelName}' channel.` };
            commands.registerCommand(command, {
                execute: () => {
                    const timer = this.timers.get(channelName);
                    if (timer === undefined) {
                        this.timers.set(channelName, window.setInterval(() => {
                            const channel = this.ocm.getChannel(channelName);
                            if (channel) {
                                channel.appendLine(`${channelName}: ${Date.now()}`);
                            }
                        }, 500));
                    } else {
                        window.clearInterval(timer);
                        this.timers.delete(channelName);
                    }
                }
            });
        }
    }

}
