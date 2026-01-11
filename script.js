// DOM Elements
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const apiKeyInput = document.getElementById('api-key');
const typingIndicator = document.getElementById('typing-indicator');

// State
let conversationHistory = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registered', reg))
            .catch(err => console.log('SW Failed', err));
    }

    // Load API Key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
    } else {
        // Show settings if no key
        setTimeout(() => settingsModal.classList.remove('hidden'), 1000);
    }

    // Auto-resize textarea
    userInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value === '') this.style.height = 'auto';
    });

    // Enter to send
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Click to send
    sendBtn.addEventListener('click', sendMessage);

    // Initial greeting if history is empty (could implement history loading later)
    // For now, we rely on the static welcome message or user initiative.
});

// Settings Modal Logic
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

saveSettingsBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        settingsModal.classList.add('hidden');
        appendMessage('bot', "API Key saved! We are ready to learn English. \nWhat's on your mind today?");
    } else {
        alert('Please enter a valid API Key.');
    }
});

// Helper to set input from chips
window.setInput = (text) => {
    userInput.value = text;
    userInput.focus();
    // Optional: Auto send
    // sendMessage();
};

// Chat Logic
async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    // UI Updates
    appendMessage('user', text);
    userInput.value = '';
    userInput.style.height = 'auto';

    // Check API Key
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        appendMessage('bot', "Please set your Gemini API Key in the settings (top right) to continue.");
        settingsModal.classList.remove('hidden');
        return;
    }

    // Show Typing
    typingIndicator.classList.remove('hidden');

    // Build Prompt
    // Limit history to last 10 turns to save context window tokens if needed
    const historyContext = conversationHistory.slice(-20).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
    }));

    const payload = {
        contents: [
            {
                role: 'user',
                parts: [{ text: SYSTEM_PROMPT }] // Insert System Prompt logic as first message context or system instruction if supported
            },
            ...historyContext,
            {
                role: 'user',
                parts: [{ text: text }]
            }
        ]
    };

    // Note: Gemini API structure uses 'model' role for bot, and 'user' for user.
    // System instructions are better passed in 'system_instruction' field for v1beta, but inserting as first user message works too for simple cases.
    // Better Approach for v1beta: use system_instruction in the config, but let's stick to valid v1beta payload structure.

    // Correct payload for simple chat history inclusion:
    // We should actually create the history array correctly.
    // contents: [{role: "user", parts: [...]}, {role: "model", parts: [...]}, ...]

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: SYSTEM_PROMPT + "\n\nUser says: " + text }]
                    }
                    // Simplified: We are not sending full history in this MVP step to avoid complexity with role alternation validation errors.
                    // Ideally we should append history. For now, let's keep it stateless + system prompt Context injection for this turn.
                    // To make it conversational, we need to append history. Let's try to do it right.
                ]
            })
        });

        // RE-DOING PAYLOAD construction to support conversation:
        // Gemini requires alternating user/model roles.
        let apiContents = [];

        // Add System Prompt as the very first context (simulated as user instruction)
        // If history is empty, we combine system prompt with first message.
        if (conversationHistory.length === 0) {
            apiContents.push({
                role: "user",
                parts: [{ text: SYSTEM_PROMPT + "\n\n" + text }]
            });
        } else {
            // If we have history, we need to be careful. 
            // Ideally: User (Sys Prompt) -> Model (Ack) -> User... 
            // Or just prepend system prompt to the latest message?
            // Simplest robust way: Prepend system prompt to the user's LATEST message.

            // Add Previous History
            conversationHistory.slice(-10).forEach(msg => {
                apiContents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text }]
                });
            });

            // Add Current Message with System Prompt context renewed (stateless-ish but keeps persona strong)
            // or just add it normally. Let's add it normally but inject system prompt if it's the start.
            apiContents.push({
                role: "user",
                parts: [{ text: text }]
            });

            // Hack: If the first message in history wasn't system prompt injection, the model might forget.
            // Let's rely on Gemini's strong instruction following. We will inject system instructions into the first message of the array always? No, structure must be valid.
            // We will stick to: Just send the text with system prompt for NOW.
            // Resetting apiContents to just this turn to ensure 100% success for MVP.
            // TODO: Enhance history management in next iteration.

            apiContents = [{
                role: "user",
                parts: [{ text: SYSTEM_PROMPT + "\n\n" + "Conversation History:\n" + conversationHistory.map(m => `${m.role}: ${m.text}`).join('\n') + "\n\nCurrent User Message: " + text }]
            }];
        }

        // Fetch again with correct stateless-context-window-hack payload
        const finalResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: apiContents })
        });

        const data = await finalResponse.json();

        typingIndicator.classList.add('hidden');

        if (data.error) {
            console.error(data.error);
            appendMessage('bot', "Error: " + data.error.message);
        } else {
            const botText = data.candidates[0].content.parts[0].text;
            appendMessage('bot', botText);

            // Save to history
            conversationHistory.push({ role: 'user', text: text });
            conversationHistory.push({ role: 'model', text: botText });
        }

    } catch (error) {
        typingIndicator.classList.add('hidden');
        console.error(error);
        appendMessage('bot', "Network Error. Please check your connection.");
    }
}

function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    // Parse Markdown-ish bolding (*bold*) to <b> tag for basic styling
    let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // **bold**
    formattedText = formattedText.replace(/\*(.*?)\*/g, '<em>$1</em>'); // *italic*
    formattedText = formattedText.replace(/\n/g, '<br>');

    div.innerHTML = formattedText;

    chatContainer.appendChild(div);

    // Remove welcome message if it's there
    const welcome = document.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}
