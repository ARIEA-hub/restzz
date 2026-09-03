(function () {
    const transitionDuration = 180;
    const supportedFaqQuestions = [
        'Which restaurants are open right now?',
        'How do I book a table?',
        'Can I reserve a table for 2 tonight?',
        'What is my current queue position?',
        'How long is the estimated wait?',
        'How do I leave the queue?',
        'Am I in more than one queue?',
        'How do I cancel a reservation?'
    ];

    document.documentElement.classList.add('page-ready');

    function isInternalPageLink(link) {
        if (!link || !link.href || link.target === '_blank') return false;
        if (link.hasAttribute('download') || link.href.startsWith('javascript:')) return false;

        const url = new URL(link.href, window.location.href);
        return url.origin === window.location.origin && url.pathname.endsWith('.html');
    }

    document.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (!isInternalPageLink(link) || link.id === 'logoutCustomer' || link.id === 'logoutAdmin') return;

        const url = new URL(link.href, window.location.href);
        if (url.href === window.location.href) return;

        event.preventDefault();
        document.body.classList.add('page-exit');
        window.setTimeout(() => {
            window.location.href = url.href;
        }, transitionDuration);
    });

    function updateCustomerName(name) {
        const cleanName = String(name || '').trim();
        if (!cleanName) return;

        localStorage.setItem('customer_name', cleanName);
        document.querySelectorAll('#navUserName, [data-customer-name]').forEach((element) => {
            element.textContent = cleanName;
        });

        document.querySelectorAll('#navUserInitial').forEach((element) => {
            element.textContent = cleanName.charAt(0).toUpperCase();
        });
    }

    async function loadCustomerName() {
        const customerId = localStorage.getItem('customer_id');
        if (!customerId || customerId === 'undefined' || customerId === 'null') return;

        const storedName = localStorage.getItem('customer_name');
        if (storedName) updateCustomerName(storedName);

        try {
            const response = await fetch(`http://localhost:5000/api/users/${customerId}`);
            if (!response.ok) return;

            const user = await response.json();
            updateCustomerName(user.name);
        } catch (error) {
            console.warn('Unable to load customer name:', error);
        }
    }

    function ensureChatbot() {
        if (document.getElementById('qsense-chatbot')) return;

        const chatbot = document.createElement('div');
        chatbot.id = 'qsense-chatbot';
        chatbot.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:9999;font-family:Inter,sans-serif';
        chatbot.innerHTML = `
            <button id="chatbot-toggle" type="button" aria-label="Open Q-Sense Assistant" style="width:64px;height:64px;border:0;border-radius:50%;background:linear-gradient(135deg,#3178c6,#245ea3);color:#fff;font-size:28px;box-shadow:0 12px 30px rgba(49,120,198,.35);cursor:pointer">💬</button>
            <div id="chatbot-panel" style="display:none;width:340px;max-width:calc(100vw - 24px);background:#fff;border-radius:18px;box-shadow:0 20px 40px rgba(0,0,0,.14);border:1px solid #e7edf3;overflow:hidden;margin-bottom:12px">
                <div style="padding:14px 16px;background:#3178c6;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:space-between"><span>Q-Sense Assistant</span><button id="chatbot-close" type="button" aria-label="Close assistant" style="background:transparent;border:0;color:#fff;font-size:28px;cursor:pointer;line-height:1">×</button></div>
                <div id="chatbot-messages" style="height:260px;overflow-y:auto;padding:14px;background:#f7fafd;display:flex;flex-direction:column;gap:10px"><div style="max-width:82%;background:#fff;border:1px solid #e5ecf3;border-radius:12px 12px 12px 4px;padding:10px 12px;color:#334;font-size:.92rem">Hi! Ask about reservations, queues, table availability, or restaurant info.</div></div>
                <form id="chatbot-form" style="display:flex;border-top:1px solid #e7edf3;padding:10px;background:#fff;gap:8px"><input id="chatbot-input" type="text" placeholder="Ask about bookings or queues..." style="flex:1;border:1px solid #dfeaf5;border-radius:10px;padding:10px 12px;font-size:.92rem;outline:0"><button type="submit" style="background:#3178c6;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer">Send</button></form>
            </div>`;
        document.body.appendChild(chatbot);

        const toggle = chatbot.querySelector('#chatbot-toggle');
        const panel = chatbot.querySelector('#chatbot-panel');
        const close = chatbot.querySelector('#chatbot-close');
        const form = chatbot.querySelector('#chatbot-form');
        const input = chatbot.querySelector('#chatbot-input');
        const messages = chatbot.querySelector('#chatbot-messages');

        const appendMessage = (text, isUser) => {
            const bubble = document.createElement('div');
            bubble.textContent = text;
            bubble.style.cssText = `max-width:82%;padding:10px 12px;border-radius:${isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px'};align-self:${isUser ? 'flex-end' : 'flex-start'};background:${isUser ? '#3178c6' : '#fff'};color:${isUser ? '#fff' : '#2e3a46'};border:${isUser ? '0' : '1px solid #e5ecf3'};font-size:.92rem`;
            messages.appendChild(bubble);
            messages.scrollTop = messages.scrollHeight;
        };

        toggle.addEventListener('click', () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
        close.addEventListener('click', () => { panel.style.display = 'none'; });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const message = input.value.trim();
            if (!message) return;

            appendMessage(message, true);
            input.value = '';
            try {
                const response = await fetch('http://localhost:5000/api/chatbots/message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
                    },
                    body: JSON.stringify({ message, userId: localStorage.getItem('customer_id') })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'The assistant could not answer right now.');
                appendMessage(data.reply || 'I could not generate a response for that question.', false);
            } catch (error) {
                console.error('Chatbot request failed:', error);
                appendMessage(error.message, false);
            }
        });
    }

    function addChatbotFaq() {
        const chatbot = document.getElementById('qsense-chatbot');
        const form = document.getElementById('chatbot-form');
        const input = document.getElementById('chatbot-input');
        if (!chatbot || !form || !input || chatbot.querySelector('.chatbot-faq')) return;

        const faq = document.createElement('div');
        faq.className = 'chatbot-faq';
        faq.innerHTML = '<span class="chatbot-faq-title">Try a question</span>';

        supportedFaqQuestions.forEach((question) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chatbot-faq-question';
            button.textContent = question;
            button.addEventListener('click', () => {
                input.value = question;
                input.focus();
            });
            faq.appendChild(button);
        });

        form.parentNode.insertBefore(faq, form);
    }

    ensureChatbot();
    addChatbotFaq();
    loadCustomerName();
})();
