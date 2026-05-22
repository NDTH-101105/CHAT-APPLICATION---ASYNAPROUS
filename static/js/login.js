/* ========================================================
   LOGIN.JS — Full Interactive Login Script
   Features:
   - Particles background animation
   - Mascot eye tracking (follows mouse)
   - Hands cover eyes when typing password
   - Shake on wrong password
   - Loading spinner on submit
   - Jump animation on success
   - Show/hide password toggle
   ======================================================== */

/* ===== 1. PARTICLES BACKGROUND ===== */
(function initParticles() {
    const canvas = document.getElementById('particles-canvas');
    const ctx = canvas.getContext('2d');
    let particles = [];
    let W, H;

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const COLORS = ['#6c63ff', '#f72585', '#4cc9f0', '#f9c74f', '#a8edea'];

    class Particle {
        constructor() { this.reset(true); }

        reset(initial = false) {
            this.x = Math.random() * W;
            this.y = initial ? Math.random() * H : H + 20;
            this.size = Math.random() * 3 + 1;
            this.speedY = -(Math.random() * 0.8 + 0.3);
            this.speedX = (Math.random() - 0.5) * 0.4;
            this.opacity = Math.random() * 0.7 + 0.2;
            this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
            this.twinkle = Math.random() * Math.PI * 2;
            this.twinkleSpeed = Math.random() * 0.03 + 0.01;
            this.shape = Math.random() > 0.7 ? 'star' : 'circle';
        }

        drawStar(cx, cy, r) {
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
                const x = cx + r * Math.cos(angle);
                const y = cy + r * Math.sin(angle);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath();
        }

        update() {
            this.y += this.speedY;
            this.x += this.speedX;
            this.twinkle += this.twinkleSpeed;
            const currentOpacity = this.opacity * (0.6 + 0.4 * Math.sin(this.twinkle));

            ctx.save();
            ctx.globalAlpha = currentOpacity;
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 8;

            if (this.shape === 'star') {
                this.drawStar(this.x, this.y, this.size * 1.5);
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            if (this.y < -20 || this.x < -20 || this.x > W + 20) this.reset();
        }
    }

    // Initialize 120 particles
    for (let i = 0; i < 120; i++) particles.push(new Particle());

    // Add 2 new particles per frame to maintain density
    let frameCount = 0;
    function animate() {
        ctx.clearRect(0, 0, W, H);
        frameCount++;
        if (frameCount % 20 === 0 && particles.length < 150) {
            particles.push(new Particle());
        }
        particles.forEach(p => p.update());
        requestAnimationFrame(animate);
    }
    animate();
})();


/* ===== 2. MASCOT EYE TRACKING ===== */
(function initMascotTracking() {
    const leftPupil = document.getElementById('left-pupil');
    const rightPupil = document.getElementById('right-pupil');
    const leftShine = document.getElementById('left-shine');
    const rightShine = document.getElementById('right-shine');
    const mascot = document.getElementById('mascot');

    // Original positions
    const eyes = {
        left:  { cx: 82, cy: 100, maxOffset: 5 },
        right: { cx: 118, cy: 100, maxOffset: 5 }
    };

    function movePupils(mouseX, mouseY) {
        const mascotRect = mascot.getBoundingClientRect();
        const mascotCX = mascotRect.left + mascotRect.width / 2;
        const mascotCY = mascotRect.top + mascotRect.height * 0.47;

        [
            { el: leftPupil, shine: leftShine, base: eyes.left },
            { el: rightPupil, shine: rightShine, base: eyes.right }
        ].forEach(({ el, shine, base }) => {
            const dx = mouseX - mascotCX;
            const dy = mouseY - mascotCY;
            const angle = Math.atan2(dy, dx);
            const dist = Math.min(Math.hypot(dx, dy), 200);
            const factor = (dist / 200) * base.maxOffset;
            const px = base.cx + Math.cos(angle) * factor;
            const py = base.cy + Math.sin(angle) * factor;

            el.setAttribute('cx', px);
            el.setAttribute('cy', py);
            shine.setAttribute('cx', px + 3);
            shine.setAttribute('cy', py - 2);
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!isPasswordFocused) movePupils(e.clientX, e.clientY);
    });

    // Expose for use in password handler
    window._movePupils = movePupils;
})();


/* ===== 3. PASSWORD FIELD — COVER EYES ===== */
let isPasswordFocused = false;
const passwordInput = document.getElementById('password');
const handsEl = document.getElementById('hands-cover');
const eyesGroup = document.getElementById('eyes-group');

function setCoverEyes(cover) {
    isPasswordFocused = cover;
    if (cover) {
        handsEl.style.opacity = '1';
        eyesGroup.style.opacity = '0';
        // Reset pupils to center
        document.getElementById('left-pupil').setAttribute('cx', '82');
        document.getElementById('left-pupil').setAttribute('cy', '100');
        document.getElementById('right-pupil').setAttribute('cx', '118');
        document.getElementById('right-pupil').setAttribute('cy', '100');
    } else {
        handsEl.style.opacity = '0';
        eyesGroup.style.opacity = '1';
    }
}

passwordInput.addEventListener('focus', () => setCoverEyes(true));
passwordInput.addEventListener('blur', () => setCoverEyes(false));


/* ===== 4. SHOW / HIDE PASSWORD ===== */
const toggleBtn = document.getElementById('togglePassword');
const eyeIcon = document.getElementById('eyeIcon');

toggleBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    eyeIcon.className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';

    // If showing password, reveal eyes partially (peek)
    if (!isPassword) {
        handsEl.style.opacity = '0.3';
        eyesGroup.style.opacity = '1';
    } else {
        handsEl.style.opacity = '1';
        eyesGroup.style.opacity = '0';
    }
});


/* ===== 5. INPUT FOCUS EFFECTS ===== */
document.querySelectorAll('.input-group input').forEach(input => {
    input.addEventListener('focus', () => {
        input.closest('.input-group').style.zIndex = '2';
    });
    input.addEventListener('blur', () => {
        input.closest('.input-group').style.zIndex = '';
    });
});


/* ===== 6. FORM SUBMISSION ===== */
const loginForm = document.getElementById('loginForm');
const submitBtn = document.getElementById('submitBtn');
const loginCard = document.getElementById('loginCard');
const errorMsg = document.getElementById('errorMsg');
const successOverlay = document.getElementById('successOverlay');
const mascotEl = document.getElementById('mascot');

// API Helper Functions
const apiRequest = async (url, options = {}) => {
    const defaultOptions = {
        method: 'GET',
        headers: {}
    };

    const finalOptions = { ...defaultOptions, ...options };

    // Ensure headers are properly merged
    finalOptions.headers = {
        ...defaultOptions.headers,
        ...options.headers
    };

    // Only set Content-Type for POST/PUT/PATCH (requests with body)
    const method = (finalOptions.method || 'GET').toString().toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        finalOptions.headers = finalOptions.headers || {};
        if (!finalOptions.headers['Content-Type'] && !finalOptions.headers['content-type']) {
            finalOptions.headers['Content-Type'] = 'application/json';
        }
    }

    // Ensure credentials sent for same-origin so cookies are included
    if (!finalOptions.credentials) finalOptions.credentials = 'same-origin';

    // Only attach a JSON body for non-GET/HEAD requests to avoid server issues
    if (method === 'GET' || method === 'HEAD') {
        // Ensure no body for GET/HEAD
        delete finalOptions.body;
    } else {
        if (finalOptions.body === undefined) {
            finalOptions.body = JSON.stringify({});
        } else if (typeof finalOptions.body === 'object') {
            finalOptions.body = JSON.stringify(finalOptions.body);
        }
    }

    try {
        const response = await fetch(url, finalOptions);
        return response;
    } catch (error) {
        console.error(`API request failed for ${url}:`, error);
        throw error;
    }
};

const loginUser = async (username, password) => {
    const basicAuth = encodeBasicAuth(username, password);

    return await apiRequest('/login', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    });
};

const checkSession = async () => {
    return await apiRequest('/whoami', {
        method: 'GET'
    });
};

// Encode credentials to base64 for Basic Authentication
function encodeBasicAuth(username, password) {
    const credentials = `${username}:${password}`;
    return btoa(credentials);  // Base64 encoding
}

// Decode base64 (for verification if needed)
function decodeBasicAuth(encoded) {
    return atob(encoded);  // Base64 decoding
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    // Validate inputs
    if (!username || !password) {
        handleError('Please enter username and password');
        return;
    }

    // Clear error
    errorMsg.classList.remove('show');

    // Show loading state
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    // Encode credentials to base64
    const basicAuth = encodeBasicAuth(username, password);

    try {
        // Send login request using the helper function
        const response = await loginUser(username, password);

        if (response.ok) {
            console.log('Authentication successful');
            handleSuccess();
        } else {
            const errorText = await response.text();
            console.error('Authentication failed:', response.status, errorText);
            handleError('Authentication failed');
        }

    } catch (error) {
        console.error('Login error:', error);
        handleError('An error occurred during login');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});

function handleError(message = 'Invalid credentials') {
    // Show error message
    errorMsg.textContent = message;
    errorMsg.classList.add('show');

    // Shake card
    loginCard.classList.remove('shake');
    void loginCard.offsetWidth; // reflow trick
    loginCard.classList.add('shake');
    loginCard.addEventListener('animationend', () => {
        loginCard.classList.remove('shake');
    }, { once: true });

    // Mascot looks sad (peek from behind hands)
    handsEl.style.opacity = '0.6';
    eyesGroup.style.opacity = '1';
    // Move pupils down (sad look)
    document.getElementById('left-pupil').setAttribute('cy', '106');
    document.getElementById('right-pupil').setAttribute('cy', '106');

    setTimeout(() => {
        if (isPasswordFocused) {
            handsEl.style.opacity = '1';
            eyesGroup.style.opacity = '0';
        }
    }, 1500);

    // Shake input borders
    ['usernameGroup', 'passwordGroup'].forEach(id => {
        const el = document.getElementById(id);
        const input = el.querySelector('input');
        input.style.borderColor = 'var(--error)';
        input.style.boxShadow = '0 0 0 3px rgba(255,107,107,0.2)';
        setTimeout(() => {
            input.style.borderColor = '';
            input.style.boxShadow = '';
        }, 2000);
    });
}

function handleSuccess() {
    // Make mascot uncover eyes and jump
    setCoverEyes(false);

    // Happy pupils
    document.getElementById('left-pupil').setAttribute('cy', '96');
    document.getElementById('right-pupil').setAttribute('cy', '96');

    // Jump animation
    mascotEl.classList.add('jumping');
    mascotEl.addEventListener('animationend', () => {
        mascotEl.classList.remove('jumping');
    }, { once: true });

    // Show success overlay after a moment
    setTimeout(() => {
        successOverlay.classList.add('show');
        // Redirect to main page after success
        setTimeout(() => {
            window.location.href = '/index.html';
        }, 1500);
    }, 800);
}


/* ===== 7. CHECK SESSION & REDIRECT ===== */
function checkAndRedirectIfAuthenticated() {
    // Check if user already has a valid session based on the dedicated whoami endpoint
    checkSession()
        .then(response => {
            if (response.ok) {
                console.log('[Login] User already authenticated, redirecting to index.html');
                window.location.href = '/index.html';
            }
        })
        .catch(error => {
            console.log('[Login] Session check request failed:', error);
        });
}


/* ===== 8. REMEMBER ME — RESTORE USERNAME ===== */
const rememberMe = document.getElementById('rememberMe');
const usernameInput = document.getElementById('username');

// Load saved username on page load and check for existing session
document.addEventListener('DOMContentLoaded', () => {
    // Check if user already has valid session
    checkAndRedirectIfAuthenticated();
    
    // Load saved username
    const savedUser = localStorage.getItem('rememberedUser');
    if (savedUser) {
        usernameInput.value = savedUser;
        rememberMe.checked = true;
    }
});

// Update remember me when form is submitted (successful or not)
loginForm.addEventListener('submit', () => {
    if (rememberMe.checked) {
        localStorage.setItem('rememberedUser', usernameInput.value.trim());
    } else {
        localStorage.removeItem('rememberedUser');
    }
}, false);


/* ===== 9. FLOATING LABEL INTERACTION ===== */
// Placeholder trick for floating labels (already handled in CSS with :not(:placeholder-shown))


/* ===== 10. KEYBOARD ACCESSIBILITY ===== */
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && successOverlay.classList.contains('show')) {
        successOverlay.classList.remove('show');
    }
});