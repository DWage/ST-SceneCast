import { loadConfig, refreshActiveProfileForCurrentChat } from './config.js';
import { mountSidebarPanel } from './ui.js';
import { startDismissalClock, resetStage } from './stage.js';
import { attachTimelineWatcher, detachTimelineWatcher } from './timeline.js';
import { processIncomingMessage } from './scanner.js';

const { eventSource, event_types } = SillyTavern.getContext();

eventSource.on(event_types.APP_READY, () => {
    refreshActiveProfileForCurrentChat();
    mountSidebarPanel();
    startDismissalClock();
    attachTimelineWatcher();
});

eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
    const state = loadConfig();
    if (!state.isActive) return;

    const { chat } = SillyTavern.getContext();
    const message = chat[messageId];
    if (!message || message.is_user) return;

    processIncomingMessage(message.mes ?? '');
});

eventSource.on(event_types.CHAT_CHANGED, () => {
    detachTimelineWatcher();
    refreshActiveProfileForCurrentChat();
    resetStage();
    attachTimelineWatcher();
    mountSidebarPanel();
});
