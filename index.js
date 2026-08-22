import { loadConfig, refreshActiveProfileForCurrentChat } from './src/config.js';
import { mountSidebarPanel } from './src/ui.js';
import { resetStage } from './src/stage.js';
import { processIncomingMessage } from './src/scanner.js';

const { eventSource, event_types } = SillyTavern.getContext();

eventSource.on(event_types.APP_READY, () => {
    refreshActiveProfileForCurrentChat();
    mountSidebarPanel();
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
    refreshActiveProfileForCurrentChat();
    resetStage();
    mountSidebarPanel();
});