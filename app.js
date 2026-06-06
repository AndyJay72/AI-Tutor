/**
 * NEURO-DRILL Application Logic
 * Implements Reaction Mode, Stroop Cognitive Mode, and Agility Coach.
 * Integrates Web Audio API synthesizer, Web Speech API speech synthesis,
 * high-resolution microsecond reaction timers, and interactive statistics.
 */

(function() {
    // ---------- CONSTANTS & CONFIG ----------
    const DIRECTIONS = {
        LEFT: 'LEFT',
        RIGHT: 'RIGHT'
    };

    const MODES = {
        REACTION: 'reaction',
        COGNITIVE: 'cognitive',
        AGILITY: 'agility'
    };

    const RULES = {
        WORD: 'WORD',
        ARROW: 'ARROW'
    };

    // ---------- APPLICATION STATE ----------
    let state = {
        gameMode: MODES.REACTION,
        intervalDuration: 6.0,          // in seconds
        timeRemaining: 6.0,            // in seconds
        currentDirection: DIRECTIONS.LEFT, // correct answer
        currentDisplayWord: DIRECTIONS.LEFT,
        currentDisplayArrow: DIRECTIONS.LEFT,
        activeRule: RULES.WORD,         // Stroop instruction
        isPaused: false,
        inputFrozen: false,
        
        // Stats
        streak: 0,
        maxStreak: 0,
        totalTrials: 0,
        correctTrials: 0,
        totalReactionTime: 0,          // in ms
        
        // Settings
        audioEnabled: true,
        voiceEnabled: false,
        
        // Timing references
        lastTickTime: null,
        trialStartTime: null,
        animationFrameId: null,
        feedbackTimeoutId: null,
        nextTrialTimeoutId: null
    };

    // Audio Context (lazily initialized on first user interaction)
    let audioCtx = null;

    // ---------- DOM ELEMENTS ----------
    const els = {
        ambientGlow: document.getElementById('ambientGlow'),
        particlesContainer: document.getElementById('particlesContainer'),
        currentStreak: document.getElementById('currentStreak'),
        maxStreakVal: document.getElementById('maxStreakVal'),
        accuracyPct: document.getElementById('accuracyPct'),
        trialsCount: document.getElementById('trialsCount'),
        avgReactionTime: document.getElementById('avgReactionTime'),
        tapLeftZone: document.getElementById('tapLeftZone'),
        tapRightZone: document.getElementById('tapRightZone'),
        instructionBanner: document.getElementById('instructionBanner'),
        ruleText: document.getElementById('ruleText'),
        displayCard: document.getElementById('displayCard'),
        timerProgressRing: document.getElementById('timerProgressRing'),
        timerDigits: document.getElementById('timerDigits'),
        arrowVisual: document.getElementById('arrowVisual'),
        directionWord: document.getElementById('directionWord'),
        feedbackOverlay: document.getElementById('feedbackOverlay'),
        feedbackMessage: document.getElementById('feedbackMessage'),
        feedbackSub: document.getElementById('feedbackSub'),
        btnModeReaction: document.getElementById('btnModeReaction'),
        btnModeCognitive: document.getElementById('btnModeCognitive'),
        btnModeAgility: document.getElementById('btnModeAgility'),
        intervalSlider: document.getElementById('intervalSlider'),
        sliderVal: document.getElementById('sliderVal'),
        toggleSound: document.getElementById('toggleSound'),
        toggleVoice: document.getElementById('toggleVoice'),
        resetBtn: document.getElementById('resetBtn'),
        pausePlayBtn: document.getElementById('pausePlayBtn'),
        playPauseIcon: document.getElementById('playPauseIcon'),
        playPauseText: document.getElementById('playPauseText'),
        ledgerSuccess: document.getElementById('ledgerSuccess'),
        ledgerFailed: document.getElementById('ledgerFailed'),
        historyList: document.getElementById('historyList')
    };

    // ---------- INITIALIZATION ----------
    function init() {
        loadSettingsAndStats();
        setupEventListeners();
        createParticles();
        startLoop();
        triggerNewTrial();
    }

    // ---------- LOCAL STORAGE ----------
    function loadSettingsAndStats() {
        const savedStats = localStorage.getItem('neuro_drill_stats');
        if (savedStats) {
            try {
                const parsed = JSON.parse(savedStats);
                state.maxStreak = parsed.maxStreak || 0;
                state.totalTrials = parsed.totalTrials || 0;
                state.correctTrials = parsed.correctTrials || 0;
                state.totalReactionTime = parsed.totalReactionTime || 0;
                updateStatsUI();
            } catch (e) {
                console.error("Failed to parse saved stats:", e);
            }
        }

        const savedSettings = localStorage.getItem('neuro_drill_settings');
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                state.gameMode = parsed.gameMode || MODES.REACTION;
                state.intervalDuration = parsed.intervalDuration || 6.0;
                state.audioEnabled = parsed.audioEnabled !== undefined ? parsed.audioEnabled : true;
                state.voiceEnabled = parsed.voiceEnabled !== undefined ? parsed.voiceEnabled : false;

                // Sync UI elements
                els.intervalSlider.value = state.intervalDuration;
                els.sliderVal.innerText = `${state.intervalDuration.toFixed(1)}s`;
                els.toggleSound.checked = state.audioEnabled;
                els.toggleVoice.checked = state.voiceEnabled;

                // Highlight active mode button
                document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
                if (state.gameMode === MODES.REACTION) els.btnModeReaction.classList.add('active');
                else if (state.gameMode === MODES.COGNITIVE) els.btnModeCognitive.classList.add('active');
                else if (state.gameMode === MODES.AGILITY) els.btnModeAgility.classList.add('active');
            } catch (e) {
                console.error("Failed to parse saved settings:", e);
            }
        }
    }

    function saveSettings() {
        const settings = {
            gameMode: state.gameMode,
            intervalDuration: state.intervalDuration,
            audioEnabled: state.audioEnabled,
            voiceEnabled: state.voiceEnabled
        };
        localStorage.setItem('neuro_drill_settings', JSON.stringify(settings));
    }

    function saveStats() {
        const stats = {
            maxStreak: state.maxStreak,
            totalTrials: state.totalTrials,
            correctTrials: state.correctTrials,
            totalReactionTime: state.totalReactionTime
        };
        localStorage.setItem('neuro_drill_stats', JSON.stringify(stats));
    }

    // ---------- AUDIO ENGINE (Web Audio API Synthesizer) ----------
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function playSound(type) {
        if (!state.audioEnabled) return;
        initAudio();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        const now = audioCtx.currentTime;

        if (type === 'tick') {
            // High frequency, short click
            osc.frequency.setValueAtTime(1000, now);
            gainNode.gain.setValueAtTime(0.04, now);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'correct') {
            // Chord/Sweep up
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
            gainNode.gain.setValueAtTime(0.12, now);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
            osc.start(now);
            osc.stop(now + 0.2);
        } else if (type === 'incorrect') {
            // Low buzz sweep down
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(160, now);
            osc.frequency.linearRampToValueAtTime(80, now + 0.25);
            gainNode.gain.setValueAtTime(0.12, now);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'timeout') {
            // Flat buzzer warning
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(120, now);
            gainNode.gain.setValueAtTime(0.1, now);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.4);
        }
    }

    // ---------- VOICE COACH (Speech Synthesis) ----------
    function speakDirection(direction) {
        if (!state.voiceEnabled) return;
        try {
            window.speechSynthesis.cancel(); // cancel current speak
            const utterance = new SpeechSynthesisUtterance(direction.toLowerCase());
            utterance.rate = 1.35; // slightly faster for quick reactions
            utterance.pitch = 1.0;
            
            // Try to find a premium English voice
            const voices = window.speechSynthesis.getVoices();
            const preferredVoice = voices.find(voice => 
                (voice.lang.includes('en-US') || voice.lang.includes('en-GB')) && 
                voice.name.toLowerCase().includes('google')
            );
            if (preferredVoice) utterance.voice = preferredVoice;

            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.error("SpeechSynthesis error:", e);
        }
    }

    // ---------- GAME ENGINE: CUE GENERATOR ----------
    function triggerNewTrial() {
        // Clear pending timers
        clearTimeout(state.feedbackTimeoutId);
        clearTimeout(state.nextTrialTimeoutId);
        els.feedbackOverlay.className = 'feedback-overlay'; // hide feedback

        state.inputFrozen = false;
        state.timeRemaining = state.intervalDuration;
        state.lastTickTime = performance.now();
        state.trialStartTime = performance.now();

        // 1. Pick a random correct response
        const answer = Math.random() < 0.5 ? DIRECTIONS.LEFT : DIRECTIONS.RIGHT;
        state.currentDirection = answer;

        if (state.gameMode === MODES.REACTION) {
            // Everything matches
            state.currentDisplayWord = answer;
            state.currentDisplayArrow = answer;
            els.instructionBanner.classList.remove('visible');
        } else if (state.gameMode === MODES.COGNITIVE) {
            // Cognitive Conflict (Stroop Effect)
            // Decide a rule
            state.activeRule = Math.random() < 0.5 ? RULES.WORD : RULES.ARROW;
            els.ruleText.innerText = `REACT TO THE ${state.activeRule}`;
            els.instructionBanner.classList.add('visible');

            // Generate visuals. If answer is LEFT:
            // If rule is WORD, word must be LEFT. Arrow can be LEFT or RIGHT.
            // If rule is ARROW, arrow must be LEFT. Word can be LEFT or RIGHT.
            const distract = Math.random() < 0.5;

            if (state.activeRule === RULES.WORD) {
                state.currentDisplayWord = answer;
                state.currentDisplayArrow = distract ? (answer === DIRECTIONS.LEFT ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT) : answer;
            } else {
                state.currentDisplayArrow = answer;
                state.currentDisplayWord = distract ? (answer === DIRECTIONS.LEFT ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT) : answer;
            }
        } else if (state.gameMode === MODES.AGILITY) {
            // Agility Coach
            state.currentDisplayWord = answer;
            state.currentDisplayArrow = answer;
            els.instructionBanner.classList.remove('visible');
        }

        // 2. Render visuals
        // Text rendering
        els.directionWord.innerText = state.currentDisplayWord;
        if (state.currentDisplayWord === DIRECTIONS.LEFT) {
            els.directionWord.className = 'direction-text txt-left';
        } else {
            els.directionWord.className = 'direction-text txt-right';
        }

        // Arrow rendering
        if (state.currentDisplayArrow === DIRECTIONS.LEFT) {
            els.arrowVisual.className = 'arrow-visual arrow-left';
        } else {
            els.arrowVisual.className = 'arrow-visual arrow-right';
        }

        // Style the arrow to matching direction colors
        if (state.currentDisplayArrow === DIRECTIONS.LEFT) {
            els.arrowVisual.style.color = 'var(--clr-left)';
        } else {
            els.arrowVisual.style.color = 'var(--clr-right)';
        }

        // Sync card glow borders with the rule or display word for aesthetic feel
        els.displayCard.classList.remove('active-left', 'active-right');
        if (state.currentDisplayWord === DIRECTIONS.LEFT) {
            els.displayCard.classList.add('active-left');
            els.ambientGlow.style.background = 'radial-gradient(circle, rgba(var(--clr-left-rgb), 0.12) 0%, rgba(var(--clr-right-rgb), 0.02) 60%, rgba(0,0,0,0) 100%)';
        } else {
            els.displayCard.classList.add('active-right');
            els.ambientGlow.style.background = 'radial-gradient(circle, rgba(var(--clr-left-rgb), 0.02) 0%, rgba(var(--clr-right-rgb), 0.12) 60%, rgba(0,0,0,0) 100%)';
        }

        // 3. Audio synthesis trigger
        speakDirection(state.currentDirection);
    }

    // ---------- MAIN TICK LOOP (requestAnimationFrame) ----------
    function startLoop() {
        function loop(timestamp) {
            if (state.isPaused) {
                state.lastTickTime = timestamp;
                state.animationFrameId = requestAnimationFrame(loop);
                return;
            }

            if (!state.lastTickTime) state.lastTickTime = timestamp;
            const delta = (timestamp - state.lastTickTime) / 1000; // delta in seconds
            state.lastTickTime = timestamp;

            // Only decrement timer if input is not frozen (e.g. waiting for feedback screen transition)
            if (!state.inputFrozen) {
                // Play tick beeps in the last 2 seconds
                const lastSeconds = Math.ceil(state.timeRemaining);
                state.timeRemaining -= delta;
                const newLastSeconds = Math.ceil(state.timeRemaining);

                if (state.timeRemaining > 0 && newLastSeconds < lastSeconds && newLastSeconds <= 2) {
                    playSound('tick');
                }

                if (state.timeRemaining <= 0) {
                    state.timeRemaining = 0;
                    handleTimeout();
                }
            }

            updateTimerUI();
            state.animationFrameId = requestAnimationFrame(loop);
        }
        state.animationFrameId = requestAnimationFrame(loop);
    }

    // ---------- RENDER TIMERS ----------
    function updateTimerUI() {
        // Render digits
        els.timerDigits.innerText = state.timeRemaining.toFixed(1);

        // Render SVG progress ring
        // Calculate offset: total circumference = 283
        const pct = Math.max(0, state.timeRemaining / state.intervalDuration);
        const offset = 283 - (pct * 283);
        els.timerProgressRing.style.strokeDashoffset = offset;

        // Change timer ring color dynamically as it depletes
        if (pct < 0.25) {
            els.timerProgressRing.style.stroke = 'var(--clr-fail)';
        } else if (pct < 0.5) {
            els.timerProgressRing.style.stroke = 'var(--clr-gold)';
        } else {
            els.timerProgressRing.style.stroke = 'var(--clr-left)';
        }
    }

    // ---------- GAME EVENTS: TIMEOUT / USER INPUT ----------
    function handleTimeout() {
        state.inputFrozen = true;
        playSound('timeout');

        if (state.gameMode === MODES.AGILITY) {
            // Auto Coach agility mode has no stats penalties
            triggerNewTrial();
            return;
        }

        // Game mode timeout is recorded as incorrect
        state.streak = 0;
        state.totalTrials++;
        
        updateStatsUI();
        saveStats();
        logToLedger(state.currentDirection, 'TIMEOUT', null, 'timeout');

        // Show feedback overlay
        els.feedbackOverlay.className = 'feedback-overlay incorrect';
        els.feedbackMessage.innerText = 'TIMEOUT';
        els.feedbackSub.innerText = `Correct was ${state.currentDirection}`;

        state.nextTrialTimeoutId = setTimeout(() => {
            triggerNewTrial();
        }, 1200);
    }

    function processResponse(response) {
        if (state.inputFrozen || state.isPaused || state.gameMode === MODES.AGILITY) return;
        
        state.inputFrozen = true;
        const responseTime = Math.round(performance.now() - state.trialStartTime);
        const isCorrect = response === state.currentDirection;

        state.totalTrials++;
        if (isCorrect) {
            state.correctTrials++;
            state.streak++;
            state.totalReactionTime += responseTime;
            if (state.streak > state.maxStreak) {
                state.maxStreak = state.streak;
            }
            playSound('correct');

            // Show success feedback
            els.feedbackOverlay.className = 'feedback-overlay correct';
            els.feedbackMessage.innerText = 'CORRECT';
            els.feedbackSub.innerText = `${responseTime}ms`;
            
            logToLedger(state.currentDirection, response, responseTime, 'correct');
        } else {
            state.streak = 0;
            playSound('incorrect');

            // Show error feedback
            els.feedbackOverlay.className = 'feedback-overlay incorrect';
            els.feedbackMessage.innerText = 'INCORRECT';
            els.feedbackSub.innerText = `Reaction was ${responseTime}ms`;

            logToLedger(state.currentDirection, response, responseTime, 'incorrect');
        }

        updateStatsUI();
        saveStats();

        // Brief delay before triggering next card
        state.nextTrialTimeoutId = setTimeout(() => {
            triggerNewTrial();
        }, 400);
    }

    // ---------- UI UPDATE HELPERS ----------
    function updateStatsUI() {
        els.currentStreak.innerText = state.streak;
        els.maxStreakVal.innerText = `best: ${state.maxStreak}`;
        els.trialsCount.innerText = `${state.totalTrials} trials`;

        // Accuracy
        if (state.totalTrials > 0) {
            const accuracy = Math.round((state.correctTrials / state.totalTrials) * 100);
            els.accuracyPct.innerText = `${accuracy}%`;
        } else {
            els.accuracyPct.innerText = '0%';
        }

        // Reaction speed
        if (state.correctTrials > 0) {
            const avg = Math.round(state.totalReactionTime / state.correctTrials);
            els.avgReactionTime.innerText = `${avg}ms`;
        } else {
            els.avgReactionTime.innerText = '—';
        }
    }

    function logToLedger(cue, response, latency, type) {
        // Clean empty state if first item
        const emptyState = els.historyList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const item = document.createElement('div');
        item.className = 'ledger-item';

        const directionClass = cue === DIRECTIONS.LEFT ? 'left' : 'right';
        const displayLat = latency !== null ? `${latency}ms` : '—';
        
        let statusLabel = '';
        if (type === 'correct') statusLabel = `<span class="ledger-status correct">OK</span>`;
        else if (type === 'incorrect') statusLabel = `<span class="ledger-status incorrect">ERR</span>`;
        else statusLabel = `<span class="ledger-status timeout">TIME</span>`;

        item.innerHTML = `
            <div class="ledger-cue ${directionClass}">
                ${cue === DIRECTIONS.LEFT ? '← LEFT' : 'RIGHT →'}
            </div>
            <div class="ledger-details">
                <span class="ledger-latency">${displayLat}</span>
                ${statusLabel}
            </div>
        `;

        els.historyList.insertBefore(item, els.historyList.firstChild);

        // Cap history list size
        while (els.historyList.children.length > 20) {
            els.historyList.lastChild.remove();
        }

        // Sync success/fail counter in ledger
        const correctCount = els.historyList.querySelectorAll('.ledger-status.correct').length;
        const failCount = els.historyList.querySelectorAll('.ledger-status:not(.correct)').length;
        els.ledgerSuccess.innerText = `${correctCount} Correct`;
        els.ledgerFailed.innerText = `${failCount} Missed`;
    }

    // ---------- AMBITION: PARTICLES BACKGROUND ----------
    function createParticles() {
        const count = 20;
        for (let i = 0; i < count; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle-dot';
            particle.style.left = `${Math.random() * 100}vw`;
            particle.style.top = `${Math.random() * 100}vh`;
            particle.style.animationDelay = `${Math.random() * 8}s`;
            particle.style.animationDuration = `${10 + Math.random() * 10}s`;
            els.particlesContainer.appendChild(particle);
        }
    }

    // ---------- CONTROLS & LISTENERS ----------
    function setupEventListeners() {
        // Keyboard inputs
        window.addEventListener('keydown', (e) => {
            // Ignore if input is frozen
            if (state.inputFrozen) return;

            // Initialize AudioContext on keypress to pass Safari autoplay policy
            initAudio();

            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                processResponse(DIRECTIONS.LEFT);
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                processResponse(DIRECTIONS.RIGHT);
            } else if (e.key === ' ') {
                // Space bar pauses/plays
                e.preventDefault();
                togglePause();
            }
        });

        // Tap zones click
        els.tapLeftZone.addEventListener('mousedown', () => processResponse(DIRECTIONS.LEFT));
        els.tapRightZone.addEventListener('mousedown', () => processResponse(DIRECTIONS.RIGHT));
        els.tapLeftZone.addEventListener('touchstart', (e) => {
            e.preventDefault(); // prevent double triggers on mobile
            processResponse(DIRECTIONS.LEFT);
        });
        els.tapRightZone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            processResponse(DIRECTIONS.RIGHT);
        });

        // Mouse click on display card splits left/right halves
        els.displayCard.addEventListener('click', (e) => {
            initAudio();
            const rect = els.displayCard.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const cardWidth = rect.width;
            
            if (clickX < cardWidth / 2) {
                processResponse(DIRECTIONS.LEFT);
            } else {
                processResponse(DIRECTIONS.RIGHT);
            }
        });

        // Pause/Play controls
        els.pausePlayBtn.addEventListener('click', togglePause);

        // Reset statistics
        els.resetBtn.addEventListener('click', () => {
            if (confirm("Reset all stored streaks and statistics?")) {
                state.streak = 0;
                state.maxStreak = 0;
                state.totalTrials = 0;
                state.correctTrials = 0;
                state.totalReactionTime = 0;
                
                // Clear UI
                updateStatsUI();
                els.historyList.innerHTML = '<div class="empty-state">No logs yet. Complete a trial to record latency!</div>';
                els.ledgerSuccess.innerText = `0 Correct`;
                els.ledgerFailed.innerText = `0 Missed`;
                
                saveStats();
                triggerNewTrial();
            }
        });

        // Game Mode Switchers
        els.btnModeReaction.addEventListener('click', () => changeMode(MODES.REACTION));
        els.btnModeCognitive.addEventListener('click', () => changeMode(MODES.COGNITIVE));
        els.btnModeAgility.addEventListener('click', () => changeMode(MODES.AGILITY));

        // Speed interval slider
        els.intervalSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.intervalDuration = val;
            els.sliderVal.innerText = `${val.toFixed(1)}s`;
            saveSettings();
        });

        // Toggle Audio switches
        els.toggleSound.addEventListener('change', (e) => {
            state.audioEnabled = e.target.checked;
            saveSettings();
        });
        els.toggleVoice.addEventListener('change', (e) => {
            state.voiceEnabled = e.target.checked;
            saveSettings();
            if (state.voiceEnabled) {
                initAudio();
                speakDirection(state.currentDirection);
            }
        });
    }

    function togglePause() {
        initAudio();
        state.isPaused = !state.isPaused;
        if (state.isPaused) {
            els.playPauseText.innerText = "Resume Drill";
            els.playPauseIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
            els.displayCard.style.opacity = '0.5';
        } else {
            els.playPauseText.innerText = "Pause Drill";
            els.playPauseIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
            els.displayCard.style.opacity = '1';
            state.lastTickTime = performance.now();
        }
    }

    function changeMode(newMode) {
        initAudio();
        if (state.gameMode === newMode) return;
        state.gameMode = newMode;
        
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        if (newMode === MODES.REACTION) els.btnModeReaction.classList.add('active');
        else if (newMode === MODES.COGNITIVE) els.btnModeCognitive.classList.add('active');
        else if (newMode === MODES.AGILITY) els.btnModeAgility.classList.add('active');

        saveSettings();
        triggerNewTrial();
    }

    // Start application on boot
    init();

})();
