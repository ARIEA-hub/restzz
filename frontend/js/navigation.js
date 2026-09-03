(function () {
    const transitionDuration = 180;
    const supportedFaqQuestions = [
        'Which restaurants are open right now?',
        'How do I book a table?',
        'Can I reserve a table for 2 tonight?',
        'What is my current queue position?',
        'How long is the estimated wait?',
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

    addChatbotFaq();
    loadCustomerName();
})();
