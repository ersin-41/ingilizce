// DOM Elements
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn'); // New Mic Button
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const apiKeyInput = document.getElementById('api-key');
const typingIndicator = document.getElementById('typing-indicator');

// State
let conversationHistory = [];
let recognition; // For Speech Recognition

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registered', reg))
            .catch(err => console.log('SW Failed', err));
    }

    // Initialize Speech Recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false; // Stop after one sentence
        recognition.lang = 'en-US'; // Default to English for practice
        recognition.interimResults = false;

        recognition.onstart = () => {
            micBtn.classList.add('listening');
            userInput.placeholder = "Listening...";
        };

        recognition.onend = () => {
            micBtn.classList.remove('listening');
            userInput.placeholder = "Type your message...";
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            userInput.value = transcript;
            userInput.focus();
            // Automatically send? Maybe better to let user review first.
        };

        // Mic Button Click
        micBtn.addEventListener('click', () => {
            if (micBtn.classList.contains('listening')) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });
    } else {
        micBtn.style.display = 'none'; // Hide if not supported
        console.log("Speech Recognition not supported in this browser.");
    }

    // Load API Key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
    } else {
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
});

// Settings Modal Logic
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

saveSettingsBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        settingsModal.classList.add('hidden');
        appendMessage('bot', "API Key saved! Ready to talk. Try the microphone button to practice pronunciation!");
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

// Text to Speech Function
function speakText(text) {
    if ('speechSynthesis' in window) {
        // Cancel previous speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US'; // Speak in English
        utterance.rate = 0.9; // Slightly slower for learning

        // Select a good voice if available (look for "Google US English" or similar)
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.name.includes('Google US English')) || voices.find(v => v.lang === 'en-US');
        if (preferredVoice) utterance.voice = preferredVoice;

        window.speechSynthesis.speak(utterance);
    } else {
        alert("Text-to-speech is not supported in this browser.");
    }
}

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
        appendMessage('bot', "Please set your Gemini API Key in the settings.");
        settingsModal.classList.remove('hidden');
        return;
    }

    // Show Typing
    typingIndicator.classList.remove('hidden');

    // Build Payload
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
    }

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: apiContents })
        });

        const data = await finalResponseHandler(response); // Refactored for cleaner flow

        typingIndicator.classList.add('hidden');

        if (data.error) {
            console.error(data.error);
            appendMessage('bot', "Error: " + data.error.message);
        } else {
            const botText = data.candidates[0].content.parts[0].text;
            appendMessage('bot', botText);

            // Auto-speak the response? (Optional, maybe annoying if too long. Let's let user click.)
            // speakText(botText); 

            // Save to history
            conversationHistory.push({ role: 'user', text: text });
            conversationHistory.push({ role: 'model', text: botText });
        }

    } catch (error) {
        typingIndicator.classList.add('hidden');
        console.error(error);
        appendMessage('bot', "Network Error.");
    }
}

// Helper to handle response parsing safely
async function finalResponseHandler(response) {
    return await response.json();
}

function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    // Clean text for display
    let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formattedText = formattedText.replace(/\*(.*?)\*/g, '<em>$1</em>');
    formattedText = formattedText.replace(/\n/g, '<br>');

    // Create Content Layout
    let innerHTML = '';

    if (role === 'bot') {
        // Add Speaker Button for Bot
        innerHTML = `
            <div class="message-content-wrapper">
                <div class="text-content">${formattedText}</div>
                <button class="speak-btn" aria-label="Listen" onclick="speakText(\`${text.replace(/`/g, "\\`").replace(/"/g, "&quot;")}\`)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                </button>
            </div>
        `;
    } else {
        innerHTML = formattedText;
    }

    div.innerHTML = innerHTML;
    chatContainer.appendChild(div);

    // Remove welcome message if it's there
    const welcome = document.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}
