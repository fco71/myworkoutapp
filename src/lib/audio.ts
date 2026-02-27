// Audio utilities for workout app

// Global audio context for better browser compatibility
let globalAudioContext: AudioContext | null = null;
let audioInitialized = false;

export function getAudioContext(): AudioContext | null {
  if (!globalAudioContext) {
    try {
      globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('Could not create AudioContext:', e);
      return null;
    }
  }
  return globalAudioContext;
}

// Initialize audio on first user interaction
export function initializeAudio() {
  if (audioInitialized) return;

  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().then(() => {
      audioInitialized = true;
    }).catch((e) => {
      console.warn('Failed to resume audio context:', e);
    });
  } else if (ctx) {
    audioInitialized = true;
  }
}

export async function playBeep() {
  try {
    const ctx = getAudioContext();
    if (!ctx) throw new Error('No audio context available');

    // Resume context if suspended (required by modern browsers)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Create four beeps with consistent system volume
    const delays = [0, 200, 400, 600]; // Start times in milliseconds

    delays.forEach((delay) => {
      setTimeout(() => {
        try {
          const o = ctx.createOscillator();
          const g = ctx.createGain();

          // Configure oscillator
          o.type = 'sine';
          o.frequency.value = 880; // A5 note
          o.connect(g);
          g.connect(ctx.destination);
          // Use system volume - no artificial volume reduction
          g.gain.value = 1.0;

          // Play short burst
          o.start();
          setTimeout(() => {
            try {
              o.stop();
            } catch (e) {
              // Ignore if already stopped
            }
          }, 150); // Short 150ms burst
        } catch (e) {
          console.warn('Individual beep failed:', e);
        }
      }, delay);
    });

  } catch (e) {
    console.warn('WebAudio failed, trying HTML5 Audio fallback:', e);
    // Enhanced fallback: try HTML5 Audio with multiple beeps
    try {
      const audioURL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmkiBUAAfwA=';

      // Play multiple beeps to match WebAudio version
      const delays = [0, 200, 400, 600];
      delays.forEach((delay) => {
        setTimeout(() => {
          const audio = new Audio(audioURL);
          // Use system volume - no artificial volume reduction
          audio.play().then(() => {
          }).catch((err) => {
            console.warn(`HTML5 Audio beep ${delay}ms failed:`, err);
          });
        }, delay);
      });

    } catch (fallbackError) {
      console.warn('HTML5 Audio fallback also failed:', fallbackError);
      // Visual fallback when all audio fails
      document.body.style.backgroundColor = '#dc2626';
      document.body.style.transition = 'background-color 0.2s ease';

      // Create a more prominent visual indicator
      const alertDiv = document.createElement('div');
      alertDiv.innerHTML = '⏰ Timer Complete!';
      alertDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #dc2626;
        color: white;
        padding: 20px 40px;
        border-radius: 10px;
        font-size: 24px;
        font-weight: bold;
        z-index: 10000;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        animation: pulse 1s infinite;
      `;

      // Add pulse animation
      if (!document.getElementById('timer-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'timer-pulse-style';
        style.textContent = `
          @keyframes pulse {
            0% { transform: translate(-50%, -50%) scale(1); }
            50% { transform: translate(-50%, -50%) scale(1.1); }
            100% { transform: translate(-50%, -50%) scale(1); }
          }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(alertDiv);

      // Remove visual feedback after 3 seconds
      setTimeout(() => {
        document.body.style.backgroundColor = '';
        document.body.style.transition = '';
        if (alertDiv.parentNode) {
          alertDiv.parentNode.removeChild(alertDiv);
        }
      }, 3000);

      // Try to show browser notification as well
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⏰ Timer Complete!', {
          body: 'Your countdown timer has finished.',
          icon: '/favicon.ico',
          tag: 'timer-complete' // Prevent duplicate notifications
        });
      }
    }
  }
}

// Play celebration sound for workout completion
export function playWorkoutCompletionSound() {
  try {
    // Create audio context
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Create a happy ascending melody: C-E-G-C (major triad + octave)
    const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const delays = [0, 150, 300, 450]; // Note timings

    frequencies.forEach((freq, index) => {
      setTimeout(() => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();

        // Configure oscillator for a warmer sound
        o.type = 'sine';
        o.frequency.value = freq;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.value = 1.0; // Use system volume

        // Play with slight decay for musical effect
        o.start();
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        setTimeout(() => {
          o.stop();
          // Only close context after the last note
          if (index === frequencies.length - 1) {
            setTimeout(() => ctx.close(), 100);
          }
        }, 400);
      }, delays[index]);
    });

  } catch (e) {
    console.warn('WebAudio failed for completion sound, trying fallback:', e);
    // Fallback: use the same beep as timer but shorter
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmkiBUAAfwA=');
      // Use system volume instead of setting audio.volume
      audio.play().then(() => {
      }).catch(() => {
      });
    } catch (_) {
    }

    // Show congratulatory notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('🎉 Workout Complete!', {
        body: 'Great job finishing your workout session!',
        icon: '/favicon.ico',
        tag: 'workout-complete'
      });
    }
  }
}
