'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, useCallback } from 'react';
import Script from 'next/script';
import classNames from 'classnames'; // Keep classNames as it's a utility
import { Chart } from 'chart.js/auto';
import moment from 'moment';
import 'chartjs-adapter-moment';

// Whop SDK Interface
declare global {
  interface Window {
    __app_id: string; // Provided by Canvas environment
    whop: {
      user: {
        getCurrent: () => Promise<{ id: string; name: string; email?: string; role: 'user' | 'creator' }>;
        signIn: (options?: { role?: 'user' | 'creator' }) => Promise<{ id: string; name: string; role: 'user' | 'creator' }>;
        signOut: () => Promise<void>;
      };
      data: {
        set: (path: string, data: any) => Promise<void>;
        get: (path: string) => Promise<any>;
        delete: (path: string) => Promise<void>;
        listen: (path: string, callback: (data: any) => void) => () => void; // Returns unsubscribe function
      };
      leaderboard: {
        get: (appId: string, options?: { limit?: number }) => Promise<Array<{
          id: string;
          name: string;
          avatar: string;
          xp: number;
          biggestMultiplier: string;
          gamesPlayed: number;
        }>>;
        update: (appId: string, userId: string, data: any) => Promise<void>;
      };
      payments: {
        create: (options: {
          amount: number;
          description: string;
          success_url?: string;
          metadata?: Record<string, any>;
        }) => Promise<{ status: 'succeeded' | 'failed' | 'pending'; id: string }>;
      };
      community?: {
        name: string;
        id: string;
      };
    };
  }
}

// Interface for Reward type
interface Reward {
  type: 'xp' | 'cosmetic' | 'multiplier_boost';
  rarity: 'common' | 'rare' | 'epic';
  message: string;
  amount?: number; // Only for 'xp' rewards
  id?: string;     // Only for 'cosmetic' rewards
  value?: number;  // Only for 'multiplier_boost' rewards
  duration?: number; // Only for 'multiplier_boost' rewards (in seconds)
  weight: number; // REQUIRED - was missing
}

// Define Event interface for creator state
interface Event {
  id: string;
  name: string;
  // Add other relevant fields if known
}

// Interface for XP History
interface XPHistoryEntry {
  date: string;
  xp: number;
}

// Interface for User Data
interface UserData {
  id: string;
  name: string;
  avatar_url: string;
  xp: number;
  level: number;
  totalWagered: number;
  totalWon: number;
  gamesPlayed: number;
  biggestWin: number;
  biggestMultiplier: number;
  winStreak: number;
  currentStreak: number;
  lastPlayDate: string | null;
  dailyStreak: number;
  dailyGamesPlayed: number;
  unlockedCosmetics: string[];
  activeCosmetic: string;
  xpHistory: XPHistoryEntry[];
  referralCode: string | null;
  referralEarnings: number;
  referredUsers: number;
  role: 'user' | 'creator';
}

// Interface for Leaderboard Entry
interface LeaderboardEntry {
  id: string;
  name: string;
  avatar: string;
  xp: number;
  biggestMultiplier: string;
  gamesPlayed: number;
  isCurrentUser: boolean;
}

// Define ToastType union for showToast
type ToastType = 'info' | 'error' | 'success' | 'warning' | 'social';
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export default function CrashXPGame() {
  // ALL STATE GOES HERE
  const [ui, setUi] = useState({
    currentPage: 'game',
    modal: { show: false, title: '', message: '', options: [] as { text: string; action: () => void | Promise<void> }[] },
    soundEnabled: true,
    vibrationEnabled: true,
    animationsEnabled: true,
    isCalculatingRound: false,
    toasts: [] as Toast[], // Use Toast interface
    showSettings: false,
    showMysteryBox: false,
    showSubscriptions: false, // This will be used to control the premium modal visibility
    activeFomoEventMessage: null as string | null,
    showCommunityChat: false,
    messages: [] as { id: number; user: string; text: string }[],
    showSidebar: false,
    premiumTab: 'subscriptions',
  });

  const [game, setGame] = useState({
    isRunning: false,
    isCrashed: false,
    currentMultiplier: 1.00,
    crashPoint: null as number | null,
    userWagerXP: 50,
    userCashOutMultiplier: null as number | null,
    userWinningsXP: 0,
    autoCashOut: false,
    userCashedOut: false,
    isExploding: false,
    isWaiting: true,
    lastRounds: [] as number[],
  });

  const [user, setUser] = useState<UserData>({
    id: 'guest_user',
    name: 'Guest Player',
    avatar_url: 'https://placehold.co/150x150/555555/FFFFFF?text=G',
    xp: 1000,
    level: 1,
    totalWagered: 0,
    totalWon: 0,
    gamesPlayed: 0,
    biggestWin: 0,
    biggestMultiplier: 0,
    winStreak: 0,
    currentStreak: 0,
    lastPlayDate: null,
    dailyStreak: 0,
    dailyGamesPlayed: 0,
    unlockedCosmetics: ['default'],
    activeCosmetic: 'default',
    xpHistory: [{ date: new Date().toISOString().split('T')[0], xp: 1000 }],
    referralCode: null,
    referralEarnings: 0,
    referredUsers: 0,
    role: 'user',
  });

  const [leaderboard, setLeaderboard] = useState({
    allTime: [] as LeaderboardEntry[],
  });

  // Creator state, initialized with defaults, updated from Whop SDK if available
  const [creator, setCreator] = useState({
    communityName: 'Demo Community',
    communityId: 'demo_123',
    xpBoostMultiplier: 1.0,
    referralBonus: 100,
    activeEvents: [] as Event[], // Corrected type
    primaryColor: '#6366f1',
    accentColor: '#8b5cf6',
    monthlyEarnings: 127.50,
    activeUsers: 23,
  });

  const [autoPlay, setAutoPlay] = useState({
    enabled: false,
    wagerAmount: 50,
    cashOutAt: 2.0,
    stopOnWin: false,
    stopOnLoss: false,
    maxRounds: 10,
    currentRound: 0,
    isExecutingAutoRound: false,
  });

  const [isAuthReady, setIsAuthReady] = useState(false);

  // Refs for intervals and charts
  const multiplierIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const socialProofIntervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const fomoEventIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fomoCountdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dailyStreakIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streakWarningIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const xpHistoryChartRef = useRef<Chart | null>(null);
  const unsubscribeUserRef = useRef<(() => void) | null>(null);
  const unsubscribeLeaderboardRef = useRef<(() => void) | null>(null); // Fixed type

  // Whop SDK reference
  const whopRef = useRef<typeof window.whop | null>(null);
  const userIdRef = useRef<string>('guest_user'); // Use ref to keep userId stable for callbacks

  // Sounds (empty Audio objects to avoid base64 parsing issues)
  const sounds = useRef({
    wager: typeof Audio !== 'undefined' ? new Audio() : null,
    cashout: typeof Audio !== 'undefined' ? new Audio() : null,
    crash: typeof Audio !== 'undefined' ? new Audio() : null,
    win: typeof Audio !== 'undefined' ? new Audio() : null,
    tick: typeof Audio !== 'undefined' ? new Audio() : null,
  });


  // ALL FUNCTIONS GO HERE

  // Basic utility/helper functions (not useCallback if they don't depend on state/props, or simple useCallbacks with minimal dependencies).
  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' | 'social' = 'info') => {
  const id = Date.now() + Math.random();
    setUi(prev => ({
      ...prev,
      toasts: [...prev.toasts, { id, message, type }]
    }));
    setTimeout(() => {
      setUi(prev => ({
        ...prev,
        toasts: prev.toasts.filter(toast => toast.id !== id)
      }));
    }, 3500); // Auto-hide after 3.5 seconds
  }, [setUi]);

  const vibrate = useCallback((pattern: number | number[]) => {
    if (typeof window !== 'undefined' && ui.vibrationEnabled && navigator.vibrate) { // SSR Guard
      navigator.vibrate(pattern);
    }
  }, [ui.vibrationEnabled]);

  const Haptics = {
    light: useCallback(() => vibrate(25), [vibrate]),
    medium: useCallback(() => vibrate(50), [vibrate]),
    heavy: useCallback(() => vibrate(100), [vibrate]),
    wagerPlaced: useCallback(() => vibrate([50, 30, 50]), [vibrate]),
    cashOutSuccess: useCallback(() => vibrate([75, 25, 75, 25, 150]), [vibrate]),
    crashLoss: useCallback(() => vibrate([200, 100, 200, 100, 300]), [vibrate]),
    nearMiss: useCallback(() => vibrate([150, 75, 150, 75, 150]), [vibrate])
  };

  const playSound = useCallback((soundName: keyof typeof sounds.current) => {
    if (typeof window !== 'undefined' && ui.soundEnabled && sounds.current[soundName]) { // SSR Guard
      const sound = sounds.current[soundName];
      if (sound) { // Ensure sound is not null
        sound.currentTime = 0;
        sound.play().catch(() => { }); // Catch play() promise rejection
      }
    }
  }, [ui.soundEnabled, sounds]); // Added sounds to dependencies

  const generateCrashPoint = useCallback(() => {
    // Original logic was just Math.random(), but this implies a house edge/distribution
    // Replicating the provided logic from the HTML file's window.generateCrashPoint
    const random = Math.random();
    if (random < 0.5) return 1.01 + (Math.random() * 0.5);
    if (random < 0.8) return 1.5 + (Math.random() * 1.5);
    if (random < 0.95) return 3.0 + (Math.random() * 7.0);
    return 10.0 + (Math.random() * 40.0);
  }, []);

  const updateMultiplierVisuals = useCallback(() => {
    if (typeof window === 'undefined') return; // SSR Guard
    const multiplierEl = document.querySelector('.multiplier-number');
    if (!multiplierEl) return;

    multiplierEl.classList.remove('danger-zone', 'jackpot-zone');

    if (game.currentMultiplier >= 1.5 && game.currentMultiplier < 5.0) {
      multiplierEl.classList.add('danger-zone');
    } else if (game.currentMultiplier >= 5.0) {
      multiplierEl.classList.add('jackpot-zone');
    }
  }, [game.currentMultiplier]); // Removed document from deps as it's global

  const showModal = useCallback((options: { title: string; message: string; options: { text: string; action: () => void | Promise<void> }[] }) => {
    setUi(prev => ({
      ...prev,
      modal: {
        show: true,
        title: options.title,
        message: options.message,
        options: options.options,
      }
    }));
  }, [setUi]);

  const closeModal = useCallback(() => {
    setUi(prev => ({
      ...prev,
      modal: { show: false, title: '', message: '', options: [] }
    }));
  }, [setUi]);

  const generateDummyLeaderboard = useCallback(() => {
    const names = ['CrashKing', 'XPLord', 'MultiplierMax', 'RiskTaker', 'CashOutPro', 'StreakMaster', 'BetBig', 'XPChamp', 'HighRoller', 'LuckyLooser'];
    const dummyData: LeaderboardEntry[] = [];
    for (let i = 0; i < 15; i++) {
      dummyData.push({
        id: `dummy_user_${i}`,
        name: names[i % names.length] + (i > 5 ? `_${i}` : ''),
        avatar: `https://placehold.co/50x50/${Math.floor(Math.random() * 16777215).toString(16)}/FFFFFF?text=${names[i % names.length][0]}`,
        xp: Math.floor(Math.random() * 50000) + 1000,
        biggestMultiplier: (1 + Math.random() * 20).toFixed(2),
        gamesPlayed: Math.floor(Math.random() * 1000) + 10,
        isCurrentUser: false
      });
    }
    return dummyData.sort((a, b) => b.xp - a.xp);
  }, []);

  const analyzeNearMiss = useCallback((userCashOutMultiplier: number | null, actualCrashMultiplier: number | null) => {
    if (!userCashOutMultiplier || !actualCrashMultiplier) return;

    const diff = Math.abs(userCashOutMultiplier - actualCrashMultiplier);

    if (diff < 0.1 && userCashOutMultiplier < actualCrashMultiplier) {
      // showNearMissEffect(); // Not implemented in React yet, keeping it as a stub
      showToast(`SO CLOSE! You cashed out just before crash at ${userCashOutMultiplier.toFixed(2)}x, but it crashed at ${actualCrashMultiplier.toFixed(2)}x!`, 'warning');
      Haptics.nearMiss();
    }
  }, [showToast, Haptics]);

  const activateXPBoost = useCallback((boost: { multiplier: number; duration: number; name?: string }) => {
    setCreator(prev => ({ ...prev, xpBoostMultiplier: boost.multiplier }));
    showToast(`XP Boost activated: ${boost.multiplier}x for ${boost.duration / 60} minutes!`, 'success');
    setTimeout(() => {
      setCreator(prev => ({ ...prev, xpBoostMultiplier: 1.0 }));
      showToast('XP Boost expired!', 'info');
    }, boost.duration * 1000);
  }, [showToast, setCreator]);

  const randomUsername = useCallback(() => {
    const adjectives = ['Cool', 'Awesome', 'Lucky', 'Fast', 'XP'];
    const nouns = ['Gamer', 'Player', 'Lord', 'King', 'Master'];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}${Math.floor(Math.random() * 99)}`;
  }, []);

  // Forward declaration for updateLeaderboardEntry to resolve circular dependency with updateUserData
  const updateLeaderboardEntry = useCallback(async () => {
    if (!whopRef.current || userIdRef.current === 'guest_user' || !isAuthReady) {
      console.warn("Whop SDK not ready or user is guest. Skipping leaderboard update.");
      return;
    }
    try {
      const currentUserData = user;
      const dataToSave = {
        id: currentUserData.id,
        name: currentUserData.name,
        avatar: currentUserData.avatar_url,
        xp: currentUserData.xp,
        biggestMultiplier: parseFloat(currentUserData.biggestMultiplier.toFixed(2)),
        gamesPlayed: currentUserData.gamesPlayed
      };
      // Whop SDK: Update leaderboard entry
      await whopRef.current.leaderboard.update(window.__app_id, userIdRef.current, dataToSave);
    } catch (error) {
      console.error("Error updating leaderboard entry:", error);
      showToast("Failed to update leaderboard.", "error");
    }
  }, [user, isAuthReady, showToast, whopRef]);

  // Forward declaration for renderXpHistoryChart to resolve circular dependency with updateUserData
  const renderXpHistoryChart = useCallback(() => {
    if (typeof window === 'undefined') return; // SSR Guard
    const ctx = document.getElementById('xpHistoryChart') as HTMLCanvasElement;
    if (!(ctx instanceof HTMLCanvasElement)) return; // Null check and type check

    const history = user.xpHistory;
    const labels = history.map(entry => moment(entry.date).format('MMM D, YYYY'));
    const data = history.map(entry => entry.xp);

    if (xpHistoryChartRef.current) {
      xpHistoryChartRef.current.destroy();
      xpHistoryChartRef.current = null; // Cleanup and null assignment
    }

    xpHistoryChartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'XP Over Time',
          data: data,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.2)',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
  x: {
    type: 'time',
    time: {
      unit: 'day',
      tooltipFormat: 'MMM D,YYYY',
    },
    title: {
      display: true,
      text: 'Date',
      color: '#e2e8f0'
    },
            ticks: {
              color: '#9ca3af'
            },
            grid: {
              color: 'rgba(74, 85, 104, 0.3)'
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'XP',
              color: '#e2e8f0'
            },
            ticks: {
              color: '#9ca3af'
            },
            grid: {
              color: 'rgba(74, 85, 104, 0.3)'
            }
          }
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return `XP: ${context.parsed.y.toLocaleString()}`;
              }
            }
          }
        }
      }
    });
  }, [user.xpHistory]);

  const updateUserData = useCallback(async () => {
    if (!whopRef.current || !isAuthReady || user.id === 'guest_user') {
      console.warn("User is guest or not authenticated, skipping data save.");
      return;
    }
    try {
      const today = new Date().toISOString().split('T')[0];
      let newXpHistory = [...user.xpHistory];
      const lastEntry = newXpHistory[newXpHistory.length - 1];

      if (lastEntry && lastEntry.date === today) {
        lastEntry.xp = user.xp;
      } else {
        newXpHistory.push({ date: today, xp: user.xp });
      }
      setUser(prev => ({ ...prev, xpHistory: newXpHistory })); // Ensure local state is updated

      const dataToSave = {
        xp: user.xp,
        name: user.name,
        avatar_url: user.avatar_url,
        level: user.level,
        totalWagered: user.totalWagered,
        totalWon: user.totalWon,
        gamesPlayed: user.gamesPlayed,
        biggestWin: user.biggestWin,
        biggestMultiplier: user.biggestMultiplier,
        winStreak: user.winStreak,
        currentStreak: user.currentStreak,
        lastPlayDate: user.lastPlayDate,
        dailyStreak: user.dailyStreak,
        dailyGamesPlayed: user.dailyGamesPlayed,
        unlockedCosmetics: JSON.stringify(user.unlockedCosmetics),
        activeCosmetic: user.activeCosmetic,
        xpHistory: JSON.stringify(newXpHistory), // Save the updated xpHistory
        referralCode: user.referralCode,
        referralEarnings: user.referralEarnings,
        referredUsers: user.referredUsers,
        role: user.role
      };
      await whopRef.current.data.set(`users/${user.id}/crashxp_user_data`, dataToSave);
    } catch (error) {
      console.error("Error updating user data:", error);
      showToast("Failed to save user data.", "error");
    }
  }, [user, isAuthReady, showToast, setUser, whopRef]);

  const createShareableAchievement = useCallback((type: string, data: any) => {
    if (!isAuthReady || user.id === 'guest_user') {
      showToast("Sign in to share achievements!", "info");
      return;
    }

    const achievements: { [key: string]: string } = {
      big_win: `🚀 Just won ${data.amount.toLocaleString()} XP at ${data.multiplier}x in CrashXP! Can you beat that?`,
      win_streak: `🔥 On a ${data.streak}-game win streak in CrashXP! I'm unstoppable!`,
      jackpot: `💎 HIT THE JACKPOT! ${data.multiplier}x = ${data.winnings.toLocaleString()} XP!`
    };

    const shareText = achievements[type];
    if (!shareText) {
      console.warn(`Attempted to share unknown achievement type: ${type}`);
      return;
    }

    if (typeof window !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) { // SSR Guard and Navigator.clipboard safety
      navigator.clipboard.writeText(shareText).then(() => {
        showToast('Achievement copied! Share it everywhere! 🚀', 'success');
        setUser(prev => ({ ...prev, xp: prev.xp + 50 })); // Bonus for sharing
        updateUserData();
      }).catch(err => {
        console.error('Failed to copy achievement text (navigator.clipboard): ', err);
        showToast('Failed to copy achievement. You can manually copy the text.', 'error');
      });
    } else if (typeof window !== 'undefined') { // Fallback for browsers without navigator.clipboard
      showModal({
        title: "Achievement Unlocked!",
        message: `You achieved: "${shareText}" <br><br> Copy this to share: <input type="text" value="${shareText}" readonly class="w-full bg-gray-700 text-gray-200 p-2 rounded">`,
        options: [{ text: "Awesome!", action: () => { closeModal(); } }]
      });
      setUser(prev => ({ ...prev, xp: prev.xp + 50 })); // Still give bonus
      updateUserData();
    }
  }, [isAuthReady, user.id, showToast, updateUserData, showModal, closeModal, setUser]);

  const triggerMysteryBox = useCallback(async () => {
    if (!isAuthReady || user.id === 'guest_user') {
      showToast("Sign in to unlock Mystery Boxes!", "info");
      return;
    }
    setUi(prev => ({ ...prev, isCalculatingRound: true, showMysteryBox: true }));

    const rewards: Reward[] = [ // Explicitly type rewards array
      { type: 'xp', amount: 500, rarity: 'common', message: 'Bonus 500 XP!', weight: 5 },
      { type: 'xp', amount: 1000, rarity: 'rare', message: 'Big 1000 XP Boost!', weight: 2 },
      { type: 'cosmetic', id: 'golden_ring', rarity: 'epic', message: 'Golden Ring Cosmetic!', weight: 1 },
      { type: 'multiplier_boost', value: 1.1, duration: 600, rarity: 'rare', message: '1.1x XP for 10 min!', weight: 2 }
    ];

    const getWeightedRandomReward = (rewardsList: Reward[]) => {
      const totalWeight = rewardsList.reduce((sum, r) => sum + r.weight, 0);
      let random = Math.random() * totalWeight;
      for (const reward of rewardsList) {
        if (random < reward.weight) {
          return reward;
        }
        random -= reward.weight;
      }
      return rewardsList[0]; // Fallback, should not be reached
    };

    const randomReward = getWeightedRandomReward(rewards);
    setUi(prev => ({ ...prev, modal: { ...prev.modal, message: 'Opening your Mystery Box...' } }));

    setTimeout(async () => {
      let rewardMessage = randomReward.message;
      // Added type guards for all optional properties and captured them in local variables
      if (randomReward.type === 'xp' && typeof randomReward.amount === 'number') {
        const xpAmount = randomReward.amount; // Capture to ensure type safety in closure
        setUser(prev => ({ ...prev, xp: prev.xp + (xpAmount ?? 0) })); // Used nullish coalescing
        // window.showFloatingXP(randomReward.amount); // Not implemented yet
      } else if (randomReward.type === 'cosmetic' && typeof randomReward.id === 'string') {
        const cosmeticId = randomReward.id; // Capture
        setUser(prev => {
          if (!prev.unlockedCosmetics.includes(cosmeticId)) {
            return { ...prev, unlockedCosmetics: [...prev.unlockedCosmetics, cosmeticId], activeCosmetic: cosmeticId };
          } else {
            const bonusXp = 200;
            rewardMessage = `You already owned that! Here's ${bonusXp} XP instead.`;
            return { ...prev, xp: prev.xp + bonusXp };
          }
        });
      } else if (randomReward.type === 'multiplier_boost' && typeof randomReward.value === 'number' && typeof randomReward.duration === 'number') {
        const multiplierValue = randomReward.value; // Capture
        const boostDuration = randomReward.duration; // Capture
        activateXPBoost({ multiplier: multiplierValue, duration: boostDuration });
      }

      setUi(prev => ({ ...prev, modal: { ...prev.modal, message: `You won: ${rewardMessage}` }, isCalculatingRound: false }));
      showToast(`Mystery Box: ${rewardMessage}`, 'success');
      await updateUserData();
    }, 2000);
  }, [isAuthReady, user.id, user.unlockedCosmetics, user.xp, showToast, updateUserData, activateXPBoost, setUser, setUi]);

  const resetRound = useCallback(() => {
    setGame(prev => ({
      ...prev,
      isWaiting: true,
      isRunning: false,
      isCrashed: false,
      userCashedOut: false,
      userWagerXP: autoPlay.wagerAmount, // Reset to default/auto wager
      userCashOutMultiplier: null,
      userWinningsXP: 0,
      isExploding: false,
      currentMultiplier: 1.00,
    }));
  }, [autoPlay.wagerAmount, setGame]);

  const offerSecondChance = useCallback(async () => {
    if (!isAuthReady || user.id === 'guest_user') {
      showToast("Sign in to get a second chance!", "info");
      resetRound();
      return;
    }
    const hasSecondChance = true; // For now, always true for demonstration
    const lostWager = game.userWagerXP;

    if (hasSecondChance) {
      showModal({
        title: "Second Chance!",
        message: `You lost ${lostWager} XP. Revive your bet for 200 XP? (You keep current XP, but restart the round with your wager)`,
        options: [
          {
            text: "Pay 200 XP", action: async () => {
              if (user.xp >= 200) {
                setUser(prev => ({ ...prev, xp: prev.xp - 200 }));
                // Revert stats for the lost game to make it feel like a restart
                setUser(prev => ({
                  ...prev,
                  totalWagered: prev.totalWagered - lostWager,
                  gamesPlayed: prev.gamesPlayed - 1,
                  dailyGamesPlayed: prev.dailyGamesPlayed - 1
                }));
                showToast("Bet revived! Play again.", "success");
                await updateUserData();
                resetRound();
                closeModal();
              } else {
                showToast("Not enough XP for a second chance!", "error");
                resetRound();
                closeModal();
              }
            }
          },
          {
            text: "No thanks", action: () => {
              showToast("No second chance. Better luck next time!", "info");
              resetRound();
              closeModal();
            }
          }
        ]
      });
    } else {
      resetRound();
    }
  }, [isAuthReady, user.id, user.xp, game.userWagerXP, showToast, showModal, updateUserData, resetRound, closeModal, setUser]);

  const updateWinStreak = useCallback(async (won: boolean) => {
    if (!isAuthReady || user.id === 'guest_user') return;

    if (won) {
      setUser(prev => {
        const newCurrentStreak = prev.currentStreak + 1;
        const newWinStreak = newCurrentStreak > prev.winStreak ? newCurrentStreak : prev.winStreak;

        if (newCurrentStreak > 0 && newCurrentStreak % 5 === 0) {
          setTimeout(() => {
            triggerMysteryBox();
            createShareableAchievement('win_streak', { streak: newCurrentStreak });
          }, 0);
        }

        return { ...prev, currentStreak: newCurrentStreak, winStreak: newWinStreak };
      });
    } else {
      setUser(prev => ({ ...prev, currentStreak: 0 }));
    }

    await updateUserData();
  }, [isAuthReady, user.id, setUser, updateUserData, triggerMysteryBox, createShareableAchievement]);

  const crashGame = useCallback(async () => {
    if (multiplierIntervalRef.current) {
      clearInterval(multiplierIntervalRef.current);
      multiplierIntervalRef.current = null; // Cleanup and null assignment
    }
    setGame(prev => ({ ...prev, isRunning: false, isCrashed: true, isExploding: true }));

    if (!game.userCashedOut) {
      if (isAuthReady && user.id !== 'guest_user') {
        setUser(prev => ({
          ...prev,
          totalWagered: prev.totalWagered + game.userWagerXP,
          gamesPlayed: prev.gamesPlayed + 1,
          dailyGamesPlayed: prev.dailyGamesPlayed + 1
        }));
      }

      Haptics.crashLoss();
      playSound('crash');
      // createParticleEffect('crash', document.querySelector('.multiplier-display')); // No particle effect in React for now

      showToast(`CRASHED at ${game.currentMultiplier.toFixed(2)}x! You lost ${game.userWagerXP.toLocaleString()} XP.`, 'error');

      // Call updateWinStreak here *after* game.userWagerXP is finalized
      await updateWinStreak(false);

      if (Math.random() < 0.3) {
        setTimeout(() => offerSecondChance(), 1000);
      } else {
        setTimeout(() => {
          if (!autoPlay.enabled) {
            resetRound();
          }
        }, 1000);
      }
    } else {
      analyzeNearMiss(game.userCashOutMultiplier, game.crashPoint);
      setTimeout(() => {
        if (!autoPlay.enabled) {
          resetRound();
        }
      }, 1000);
    }
    setGame(prev => ({
      ...prev,
      lastRounds: [prev.currentMultiplier, ...prev.lastRounds].slice(0, 10)
    }));
    await updateUserData(); // Ensure data is saved after the full game cycle
  }, [
    game.userCashedOut, game.userWagerXP, game.currentMultiplier, game.crashPoint, game.userCashOutMultiplier,
    isAuthReady, user.id, playSound, showToast, updateUserData, resetRound, offerSecondChance, analyzeNearMiss,
    updateWinStreak, Haptics, autoPlay.enabled, setGame, setUser, multiplierIntervalRef
  ]);

  const startMultiplierClimb = useCallback(() => {
    let startTime = Date.now();
    let lastMultiplier = 1.00;

    if (multiplierIntervalRef.current) clearInterval(multiplierIntervalRef.current);

    multiplierIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      let newMultiplier = 1 + Math.pow(elapsed / 1000, 2) * 0.1;

      if (game.crashPoint && newMultiplier >= game.crashPoint) {
        newMultiplier = game.crashPoint;
        setGame(prev => ({ ...prev, currentMultiplier: newMultiplier }));
        if (multiplierIntervalRef.current) {
          clearInterval(multiplierIntervalRef.current);
          multiplierIntervalRef.current = null; // Cleanup and null assignment
        }

        // Use setTimeout to break the circular dependency with crashGame
        setTimeout(() => {
          crashGame();
        }, 0);
        return;
      }

      if (Math.abs(newMultiplier - lastMultiplier) > 0.01) {
        setGame(prev => ({ ...prev, currentMultiplier: newMultiplier }));
        lastMultiplier = newMultiplier;
        updateMultiplierVisuals();
      }
    }, 10);
  }, [game.crashPoint, updateMultiplierVisuals, setGame]);

  const startRound = useCallback(() => {
    setGame(prev => ({
      ...prev,
      crashPoint: generateCrashPoint(),
      currentMultiplier: 1.00,
      isExploding: false, // Reset exploding state
      isCrashed: false, // Reset crashed state
    }));
    startMultiplierClimb();
  }, [generateCrashPoint, startMultiplierClimb, setGame]);

  const placeWager = useCallback(async () => {
    const isGuest = !isAuthReady || user.id === 'guest_user';

    if (isGuest) {
      showToast("Playing as guest - progress won't be saved. Sign in to save progress!", "info");
    }

    if (game.isRunning) {
      showToast("A round is already in progress!", "warning");
      return;
    }

    const wager = game.userWagerXP;
    if (wager <= 0) {
      showToast('Wager must be at least 10 XP!', 'error');
      return;
    }
    if (wager > user.xp) {
      showToast('Insufficient XP!', 'error');
      return;
    }

    setUi(prev => ({ ...prev, isCalculatingRound: true }));
    setUser(prev => ({ ...prev, xp: prev.xp - wager }));
    setGame(prev => ({
      ...prev,
      userWagerXP: wager,
      isWaiting: false,
      isRunning: true,
      userCashedOut: false,
      isCrashed: false,
      isExploding: false,
      userCashOutMultiplier: null, // Reset to null
      userWinningsXP: 0,
    }));

    Haptics.wagerPlaced();
    playSound('wager');
    showToast(`Wagered ${wager} XP. Good luck!`, 'info');
    setUi(prev => ({ ...prev, isCalculatingRound: false }));

    startRound();
  }, [
    isAuthReady, user.id, user.xp, game.isRunning, game.userWagerXP,
    showToast, playSound, startRound, Haptics, setUi, setGame, setUser
  ]);

  const cashOut = useCallback(async () => {
    const isGuest = !isAuthReady || user.id === 'guest_user';

    if (isGuest) {
      showToast("Playing as guest - winnings won't be saved permanently!", "info");
    }

    if (!game.isRunning || game.userCashedOut) return;

    const multiplier = game.currentMultiplier;
    const winnings = Math.floor(game.userWagerXP * multiplier * creator.xpBoostMultiplier);

    setGame(prev => ({
      ...prev,
      userCashedOut: true,
      userCashOutMultiplier: multiplier,
      userWinningsXP: winnings,
    }));
    setUser(prev => ({
      ...prev,
      xp: prev.xp + winnings,
      totalWon: prev.totalWon + winnings,
      totalWagered: prev.totalWagered + game.userWagerXP,
      gamesPlayed: prev.gamesPlayed + 1,
      dailyGamesPlayed: prev.dailyGamesPlayed + 1,
      biggestWin: winnings > prev.biggestWin ? winnings : prev.biggestWin,
      biggestMultiplier: multiplier > prev.biggestMultiplier ? multiplier : prev.biggestMultiplier,
    }));

    Haptics.cashOutSuccess();
    playSound('cashout');
    // createParticleEffect('win', document.querySelector('.cash-out-btn')); // No particle effect in React for now

    // showFloatingXP(winnings); // No floating XP yet
    showToast(`Cashed out at ${multiplier.toFixed(2)}x! Won ${winnings.toLocaleString()} XP!`, 'success');

    if (winnings > 1000) {
      createShareableAchievement('big_win', { amount: winnings, multiplier: multiplier.toFixed(2) });
    }

    if (multiplierIntervalRef.current) {
      clearInterval(multiplierIntervalRef.current);
      multiplierIntervalRef.current = null; // Cleanup and null assignment
    }
    setGame(prev => ({ ...prev, isRunning: false, isCrashed: false }));

    await updateWinStreak(true); // Call updateWinStreak
    await updateUserData(); // Save user data after winning
    setTimeout(() => {
      if (!autoPlay.enabled) {
        resetRound();
      }
    }, 1000);
  }, [
    isAuthReady, user.id, game.isRunning, game.userCashedOut, game.currentMultiplier, game.userWagerXP, creator.xpBoostMultiplier,
    showToast, playSound, updateUserData, resetRound, autoPlay.enabled,
    updateWinStreak, Haptics, createShareableAchievement, setGame, setUser, multiplierIntervalRef
  ]);

  const setWager = useCallback((amount: number) => {
    setGame(prev => ({ ...prev, userWagerXP: Math.max(10, Math.floor(amount / 10) * 10) }));
  }, [setGame]);

  const increaseWager = useCallback(() => {
    setGame(prev => ({ ...prev, userWagerXP: Math.min(user.xp, prev.userWagerXP + 10) }));
  }, [user.xp, setGame]);

  const decreaseWager = useCallback(() => {
    setGame(prev => ({ ...prev, userWagerXP: Math.max(10, prev.userWagerXP - 10) }));
  }, [setGame]);

  const updateDailyStreak = useCallback(async () => {
    if (!isAuthReady || user.id === 'guest_user') return;

    const today = new Date().toISOString().split('T')[0];
    let lastPlay = user.lastPlayDate;

    if (!lastPlay) {
      setUser(prev => ({ ...prev, dailyStreak: 1, lastPlayDate: today }));
      await updateUserData();
      return;
    }

    if (lastPlay === today) {
      return;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (lastPlay === yesterdayStr) {
      setUser(prev => ({ ...prev, dailyStreak: prev.dailyStreak + 1 }));
      showToast(`Daily streak: ${user.dailyStreak + 1} days!`, 'success');
    } else {
      setUser(prev => ({ ...prev, dailyStreak: 1 }));
      showToast('New daily streak started!', 'info');
    }

    setUser(prev => ({ ...prev, lastPlayDate: today, dailyGamesPlayed: 0 }));

    if ((user.dailyStreak + 1) >= 3 && (user.dailyStreak + 1) % 3 === 0) {
      showToast(`Awesome! ${user.dailyStreak + 1}-day streak bonus!`, 'success');
      setUser(prev => ({ ...prev, xp: prev.xp + 100 * (prev.dailyStreak + 1) }));
    }
    await updateUserData();
  }, [isAuthReady, user.id, user.lastPlayDate, user.dailyStreak, user.xp, showToast, updateUserData, setUser]);

  const setupRealtimeLeaderboard = useCallback(async () => {
    if (!whopRef.current || !isAuthReady || user.id === 'guest_user') {
      console.warn("Whop SDK not ready or user is guest. Leaderboard will be static.");
      setLeaderboard(prev => ({ ...prev, allTime: generateDummyLeaderboard() }));
      return;
    }

    try {
      // Whop SDK: Get leaderboard data
      const leaderboardData = await whopRef.current.leaderboard.get(window.__app_id);
      let userFound = false;
      const currentUserData = user;

      const tempLeaderboard = leaderboardData.map(player => {
        const isCurrentUser = player.id === currentUserData.id;
        if (isCurrentUser) userFound = true;
        return { ...player, isCurrentUser };
      });

      if (!userFound && currentUserData.id !== 'guest_user') {
        tempLeaderboard.push({
          id: currentUserData.id,
          name: currentUserData.name,
          avatar: currentUserData.avatar_url,
          xp: currentUserData.xp,
          biggestMultiplier: currentUserData.biggestMultiplier.toFixed(2),
          gamesPlayed: currentUserData.gamesPlayed,
          isCurrentUser: true
        });

        tempLeaderboard.sort((a, b) => {
          if (b.xp !== a.xp) return b.xp - a.xp;
          return parseFloat(b.biggestMultiplier) - parseFloat(a.biggestMultiplier);
        });
      }

      setLeaderboard(prev => ({ ...prev, allTime: tempLeaderboard }));
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      showToast("Failed to load leaderboard.", "error");
    }
  }, [isAuthReady, user, showToast, generateDummyLeaderboard, whopRef, setLeaderboard]);

  const fetchUserData = useCallback(async (currentUserId: string) => {
    if (!whopRef.current || !currentUserId || typeof window === 'undefined') { // SSR Guard for window.__app_id
      console.warn("Whop SDK not ready or userId not set, or running on SSR for fetching user data.");
      return;
    }
    try {
      // Whop SDK: Get user data
      const userData = await whopRef.current.data.get(`users/${currentUserId}/crashxp_user_data`);

      if (userData) {
        setUser(prev => ({
          ...prev,
          xp: userData.xp || 1000,
          name: userData.name || `CrashLord_${currentUserId.substring(0, 4)}`,
          avatar_url: userData.avatar_url || `https://placehold.co/150x150/${Math.floor(Math.random() * 16777215).toString(16)}/FFFFFF?text=${(userData.name || `C`)[0]}`,
          level: userData.level || 1,
          totalWagered: userData.totalWagered || 0,
          totalWon: userData.totalWon || 0,
          gamesPlayed: userData.gamesPlayed || 0,
          biggestWin: userData.biggestWin || 0,
          biggestMultiplier: userData.biggestMultiplier || 0,
          winStreak: userData.winStreak || 0,
          currentStreak: userData.currentStreak || 0,
          lastPlayDate: userData.lastPlayDate || null,
          dailyStreak: userData.dailyStreak || 0,
          dailyGamesPlayed: userData.dailyGamesPlayed || 0,
          unlockedCosmetics: userData.unlockedCosmetics ? JSON.parse(userData.unlockedCosmetics) : ['default'],
          activeCosmetic: userData.activeCosmetic || 'default',
          xpHistory: userData.xpHistory ? JSON.parse(userData.xpHistory) : [{ date: new Date().toISOString().split('T')[0], xp: 1000 }],
          referralCode: userData.referralCode || prev.referralCode,
          referralEarnings: userData.referralEarnings || 0,
          referredUsers: userData.referredUsers || 0,
          role: userData.role || 'user',
        }));
      } else {
        const newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        setUser(prev => ({
          ...prev,
          xp: 1000,
          name: `CrashLord_${currentUserId.substring(0, 4)}`,
          avatar_url: `https://placehold.co/150x150/${Math.floor(Math.random() * 16777215).toString(16)}/FFFFFF?text=${`C`}`,
          xpHistory: [{ date: new Date().toISOString().split('T')[0], xp: 1000 }],
          referralCode: newReferralCode,
          referralEarnings: 0,
          referredUsers: 0,
          role: 'user',
        }));
      }
      renderXpHistoryChart();
    } catch (error) {
      console.error("Error fetching user data:", error);
      showToast("Failed to load user data.", "error");
    }
  }, [showToast, renderXpHistoryChart, setUser, whopRef]);

  const updateStreakWarning = useCallback(() => {
    if (!isAuthReady || user.id === 'guest_user') return;

    const now = new Date();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const timeLeft = endOfDay.getTime() - now.getTime();
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));

    if (hoursLeft <= 2 && user.dailyStreak > 0) {
      showToast(`⚠️ ${hoursLeft}h left to keep your ${user.dailyStreak}-day streak!`, 'warning');
    }
  }, [isAuthReady, user.id, user.dailyStreak, showToast]);

  const signInUser = useCallback(async (userAuth: { id: string; name: string; role: 'user' | 'creator' }) => {
    userIdRef.current = userAuth.id;
    setIsAuthReady(true);
    setUser(prev => ({ ...prev, id: userAuth.id, name: userAuth.name, role: userAuth.role }));
    await fetchUserData(userAuth.id);
    await setupRealtimeLeaderboard();
    updateDailyStreak();
    updateStreakWarning();
    showToast(`Welcome, ${userAuth.name}! Your progress is now saved.`, 'success');
  }, [fetchUserData, setupRealtimeLeaderboard, updateDailyStreak, updateStreakWarning, showToast, setIsAuthReady, setUser]);

  const signInAsUser = useCallback(async () => {
    if (!whopRef.current) {
      showToast("Whop SDK not initialized.", "error");
      return;
    }
    try {
      const userAuth = await whopRef.current.user.getCurrent(); // Use getCurrent first
      if (userAuth) {
        await signInUser(userAuth);
      } else {
        const newUserAuth = await whopRef.current.user.signIn({ role: 'user' });
        await signInUser(newUserAuth);
      }
    } catch (error) {
      console.error("Error signing in as user:", error);
      showToast("Failed to sign in as user. Please try again.", "error");
    }
  }, [signInUser, showToast, whopRef]);

  const signInAsCreator = useCallback(async () => {
    if (!whopRef.current) {
      showToast("Whop SDK not initialized.", "error");
      return;
    }
    try {
      const userAuth = await whopRef.current.user.getCurrent(); // Use getCurrent first
      if (userAuth) {
        await signInUser(userAuth);
      } else {
        const newUserAuth = await whopRef.current.user.signIn({ role: 'creator' });
        await signInUser(newUserAuth);
      }
    } catch (error) {
      console.error("Error signing in as creator:", error);
      showToast("Failed to sign in as creator. Please try again.", "error");
    }
  }, [signInUser, showToast, whopRef]);

  const generateReferralLink = useCallback(() => {
    if (typeof window === 'undefined') return "Referral link not available during server render."; // SSR Guard
    if (!isAuthReady || user.id === 'guest_user' || !user.referralCode) {
      return "Sign in to get your referral link!";
    }
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?ref=${user.referralCode}`;
  }, [isAuthReady, user.id, user.referralCode]);

  const copyReferralLink = useCallback(() => {
    if (typeof window === 'undefined') { // SSR Guard
      showToast("Clipboard operations not available.", "error");
      return;
    }
    if (!isAuthReady || user.id === 'guest_user') {
      showToast("Sign in to get your referral link!", "info");
      return;
    }
    const link = generateReferralLink();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => {
        showToast('Referral link copied! Earn 100 XP per friend who plays 5+ games! 🚀', 'success');
      }).catch(err => {
        console.error('Failed to copy referral link (navigator.clipboard): ', err);
        showToast('Failed to copy referral link. You can manually copy the text.', 'error');
      });
    } else {
      const tempInput = document.createElement('textarea');
      tempInput.value = link;
      document.body.appendChild(tempInput);
      tempInput.select();
      try {
        document.execCommand('copy');
        showToast('Referral link copied! Earn 100 XP per friend who plays 5+ games! 🚀', 'success');
      } catch (err) {
        console.error('Failed to copy referral link (execCommand):', err);
        showToast('Failed to copy referral link. Please copy it manually.', 'error');
      } finally {
        document.body.removeChild(tempInput);
      }
    }
  }, [isAuthReady, user.id, showToast, generateReferralLink, showModal, closeModal]);

  const trackReferral = useCallback(async (referrerCode: string, newUserId: string) => {
    console.log(`Referral tracked: referrer ${referrerCode}, new user ${newUserId}`);
    try {
      if (user.referralCode === referrerCode && user.id !== newUserId) {
        if (Math.random() > 0.5) { // Simulate successful referral after a few games
          const bonusXp = 100;
          setUser(prev => ({
            ...prev,
            referralEarnings: prev.referralEarnings + bonusXp,
            xp: prev.xp + bonusXp,
            referredUsers: prev.referredUsers + 1
          }));
          showToast(`Referral bonus: +${bonusXp} XP from a friend! 🎉`, 'success');
          await updateUserData();
        }
      }
    } catch (error) {
      console.error("Error tracking referral:", error);
      showToast("Failed to track referral.", "error");
    }
  }, [user.referralCode, user.id, showToast, updateUserData, setUser]);

  const generateSocialPressure = useCallback(() => {
    const activities = [
      () => `💰 ${randomUsername()} just won ${Math.floor(Math.random() * 5000) + 500} XP!`,
      () => `🚀 ${randomUsername()} cashed out at ${(2 + Math.random() * 8).toFixed(2)}x!`,
      () => `🔥 ${randomUsername()} hit a ${Math.floor(Math.random() * 5) + 3}-game win streak!`
    ];

    if (socialProofIntervalIdRef.current) clearInterval(socialProofIntervalIdRef.current);

    socialProofIntervalIdRef.current = setInterval(() => {
      const activity = activities[Math.floor(Math.random() * activities.length)]();
      showToast(activity, 'social');
    }, 8000);
  }, [randomUsername, showToast]);

  const activateFOMOEvent = useCallback((event: { type: string; duration: number; message: string; icon: string; multiplier?: number }) => {
    setUi(prev => ({ ...prev, activeFomoEventMessage: `${event.icon} ${event.message}` }));
    showToast(`${event.icon} Limited-time event: ${event.message}`, 'warning');

    if (event.type === '2x_xp_boost' && typeof event.multiplier === 'number') { // Ensure multiplier is a number
      setCreator(prev => ({ ...prev, xpBoostMultiplier: event.multiplier || 1.0 }));
    }

    if (fomoCountdownIntervalRef.current) clearInterval(fomoCountdownIntervalRef.current);

    const endTime = Date.now() + event.duration * 1000;

    fomoCountdownIntervalRef.current = setInterval(() => {
      const timeLeft = endTime - Date.now();
      if (timeLeft <= 0) {
        if (fomoCountdownIntervalRef.current) {
          clearInterval(fomoCountdownIntervalRef.current);
          fomoCountdownIntervalRef.current = null; // Cleanup and null assignment
        }
        setCreator(prev => ({ ...prev, xpBoostMultiplier: 1.0 }));
        setUi(prev => ({ ...prev, activeFomoEventMessage: null }));
        showToast('Limited-time event ended!', 'info');
        return;
      }
      const minutes = Math.floor(timeLeft / (1000 * 60));
      const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
      setUi(prev => ({ ...prev, activeFomoEventMessage: `${event.icon} ${event.message} (${minutes}m ${seconds}s left)` }));
    }, 1000);
  }, [showToast, setUi, setCreator]);

  const startRandomFOMOEvent = useCallback(() => {
    const events = [
      { type: '2x_xp_boost', duration: 600, message: '2x XP for 10 minutes!', icon: '🔥', multiplier: 2.0 },
      { type: 'lucky_hour', duration: 1200, message: 'Lucky Hour! Higher multipliers more often!', icon: '🍀' },
    ];

    if (Math.random() < 0.15 && !ui.activeFomoEventMessage) {
      const event = events[Math.floor(Math.random() * events.length)];
      activateFOMOEvent(event);
    }
  }, [ui.activeFomoEventMessage, activateFOMOEvent]);

  const purchaseXPBoost = useCallback(async (boostType: string) => {
    if (!isAuthReady || user.id === 'guest_user') {
      showToast("Sign in to purchase XP boosts!", "info");
      return;
    }
    const boosts: { [key: string]: { multiplier: number; duration: number; price: number; name: string } } = {
      '2x_weekend': { multiplier: 2, duration: 48 * 3600, price: 299, name: '2x Weekend Boost' },
      '3x_hour': { multiplier: 3, duration: 3600, price: 199, name: '3x Power Hour' },
      '5x_lucky': { multiplier: 5, duration: 1800, price: 499, name: '5x Lucky Strike' }
    };

    const boost = boosts[boostType];
    if (!boost) {
      console.error('Unknown boost type:', boostType);
      showToast('Error: Unknown boost type.', 'error');
      return;
    }

    try {
      if (typeof window !== 'undefined' && whopRef.current && whopRef.current.payments) { // SSR Guard
        const payment = await whopRef.current.payments.create({
          amount: boost.price,
          description: boost.name,
          success_url: typeof window !== 'undefined' ? window.location.href : 'http://localhost:3000/' // Fallback for SSR
        });
        if (payment && payment.status === 'succeeded') {
          activateXPBoost(boost);
          showToast(`${boost.name} activated! Payment successful!`, 'success');
        } else {
          showToast('Payment failed. Please try again.', 'error');
        }
      } else {
        showModal({
          title: "Purchase XP Boost",
          message: `Get ${boost.name} for $${(boost.price / 100).toFixed(2)}? (Simulated purchase)`,
          options: [
            {
              text: "Buy Now", action: async () => {
                activateXPBoost(boost);
                showToast(`${boost.name} activated! (Simulated)`, 'success');
                closeModal();
              }
            },
            { text: "Cancel", action: () => { closeModal(); } }
          ]
        });
      }
    } catch (error) {
      console.error('Whop payment error:', error);
      showToast('Payment failed. Please try again.', 'error');
    }
  }, [isAuthReady, user.id, showToast, showModal, activateXPBoost, closeModal, whopRef]);

  const buyCosmetic = useCallback(async (id: string, price: number) => {
    if (!isAuthReady || user.id === 'guest_user') {
      showToast("Sign in to buy cosmetics!", "info");
      return;
    }
    if (user.unlockedCosmetics.includes(id)) {
      showToast('You already own this item!', 'info');
      return;
    }
    if (user.xp < price) {
      showToast('Not enough XP to buy this!', 'error');
      return;
    }
    setUser(prev => ({ ...prev, xp: prev.xp - price, unlockedCosmetics: [...prev.unlockedCosmetics, id], activeCosmetic: id }));
    showToast(`Purchased & Equipped: ${id}!`, 'success');
    await updateUserData();
  }, [isAuthReady, user.id, user.unlockedCosmetics, user.xp, showToast, updateUserData, setUser]);

  const buyPremiumCosmetic = useCallback(async (id: string) => {
    if (!isAuthReady || user.id === 'guest_user') {
      showToast("Sign in to buy premium cosmetics!", "info");
      return;
    }
    showModal({
      title: "Premium Cosmetic",
      message: `This is a premium item. Simulate purchase for ${id} for $2.99? (No real money involved)`,
      options: [
        {
          text: "Confirm Purchase", action: async () => {
            if (!user.unlockedCosmetics.includes(id)) {
              setUser(prev => ({ ...prev, unlockedCosmetics: [...prev.unlockedCosmetics, id], activeCosmetic: id }));
              showToast(`Simulated Purchase & Equipped: ${id}!`, 'success');
              await updateUserData();
            } else {
              showToast('You already own this item!', 'info');
            }
            closeModal();
          }
        },
        { text: "Cancel", action: () => { closeModal(); } }
      ]
    });
  }, [isAuthReady, user.id, user.unlockedCosmetics, showToast, showModal, updateUserData, closeModal, setUser]);

  // AutoPlay Functions
  const autoPlayStop = useCallback(() => {
    setAutoPlay(prev => ({ ...prev, enabled: false, currentRound: 0, isExecutingAutoRound: false }));
    showToast('Auto-play stopped.', 'info');
  }, [showToast, setAutoPlay]);

  const autoPlayExecuteRound = useCallback(async () => {
    if (!autoPlay.enabled || autoPlay.currentRound >= autoPlay.maxRounds) {
      if (autoPlay.currentRound >= autoPlay.maxRounds) {
        showToast(`Auto-play finished ${autoPlay.maxRounds} rounds.`, 'info');
      }
      autoPlayStop();
      return;
    }

    if (user.xp < autoPlay.wagerAmount) {
      showToast('Not enough XP for auto-play wager! Auto-play stopped.', 'error');
      autoPlayStop();
      return;
    }

    setAutoPlay(prev => ({ ...prev, currentRound: prev.currentRound + 1 }));

    // Simulate placing wager. This assumes placeWager will initiate game.isRunning
    // and that its outcome will be reflected in game state.
    await placeWager();

    // Check if the game actually started. If wager failed or round already in progress, stop auto-play.
    // This part is tricky because placeWager is async and state update is not immediate.
    // We assume if placeWager is called, the game state will eventually reflect 'isRunning: true'
    // if the wager was successful. For a robust solution, placeWager should return a status.
    // For now, we proceed assuming a successful wager leads to the game running.

    let checkCashOutInterval: NodeJS.Timeout | null = null;
    checkCashOutInterval = setInterval(() => {
      // Check if game is no longer running (crashed or cashed out)
      // This relies on the game state (isRunning, isCrashed, userCashedOut) being updated by
      // crashGame or cashOut.
      if (!game.isRunning && game.isWaiting) {
        // This implies placeWager didn't successfully start the game or a round finished quickly
        if (checkCashOutInterval) clearInterval(checkCashOutInterval);
        showToast('Auto-play failed to start round or round ended prematurely. Stopping.', 'error');
        autoPlayStop();
        return;
      }

      if (!game.isRunning) { // Game has ended, either crashed or cashed out
        if (checkCashOutInterval) clearInterval(checkCashOutInterval);

        if (autoPlay.stopOnWin && game.userCashedOut) {
          showToast('Auto-play stopped: Won a round!', 'info');
          autoPlayStop();
          return;
        }
        if (autoPlay.stopOnLoss && game.isCrashed && !game.userCashedOut) {
          showToast('Auto-play stopped: Lost a round!', 'info');
          autoPlayStop();
          return;
        }
        // If not stopping, proceed to next round after a delay
        setTimeout(() => autoPlayExecuteRound(), 3000);
        return;
      }

      if (game.autoCashOut && game.currentMultiplier >= autoPlay.cashOutAt) {
        cashOut();
        if (checkCashOutInterval) clearInterval(checkCashOutInterval);
      }
    }, 50);
  }, [
    autoPlay, user.xp, game.isRunning, game.isWaiting, game.currentMultiplier, game.autoCashOut,
    game.userCashedOut, game.isCrashed, showToast, placeWager, cashOut, autoPlayStop
  ]);

  const autoPlayStart = useCallback(async () => {
    if (!isAuthReady || user.id === 'guest_user') {
      showToast("Sign in to use auto-play!", "info");
      return;
    }
    if (autoPlay.isExecutingAutoRound) {
      showToast('Auto-play is already running.', 'info');
      return;
    }
    setAutoPlay(prev => ({ ...prev, enabled: true, currentRound: 0 }));
    showToast('Auto-play started!', 'info');

    if (game.isRunning) {
      const waitForRoundEnd = setInterval(() => {
        if (!game.isRunning) {
          clearInterval(waitForRoundEnd);
          setAutoPlay(prev => ({ ...prev, isExecutingAutoRound: true }));
          autoPlayExecuteRound();
        }
      }, 100);
    } else {
      setAutoPlay(prev => ({ ...prev, isExecutingAutoRound: true }));
      autoPlayExecuteRound();
    }
  }, [isAuthReady, user.id, autoPlay.isExecutingAutoRound, game.isRunning, showToast, autoPlayExecuteRound, setAutoPlay, game.isRunning]);

  const toggleSidebar = useCallback(() => {
    setUi(prev => ({ ...prev, showSidebar: !prev.showSidebar }));
    vibrate(50);
  }, [vibrate, setUi]);

  const toggleChat = useCallback(() => {
    setUi(prev => ({ ...prev, showCommunityChat: !prev.showCommunityChat }));
    vibrate(50);
  }, [vibrate, setUi]);

  const navigate = useCallback((page: string, premiumTab = 'subscriptions') => {
    setUi(prev => ({
      ...prev,
      currentPage: page,
      premiumTab: premiumTab,
      showSubscriptions: page === 'premium',
      showSidebar: false, // Close sidebar on navigation
    }));
  }, [setUi]);

  const showSignInOptions = useCallback(() => {
    showModal({
      title: "Sign In to CrashXP",
      message: "Choose how you'd like to sign in:",
      options: [
        { text: "Sign In as User", action: async () => { await signInAsUser(); closeModal(); } },
        { text: "Sign In as Creator", action: async () => { await signInAsCreator(); closeModal(); } }
      ]
    });
  }, [showModal, signInAsUser, signInAsCreator, closeModal]);

  const handleChatMessage = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof window === 'undefined') return; // SSR Guard for DOM access
    if (event.key === 'Enter') {
      const messageText = event.currentTarget.value;
      if (messageText.trim()) {
        setUi(prev => ({
          ...prev,
          messages: [...prev.messages, { id: Date.now(), user: user.name, text: messageText }]
        }));
        event.currentTarget.value = '';
        // Scroll to bottom of chat
        const chatMessagesEl = document.querySelector('.chat-messages');
        if (chatMessagesEl) {
          chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        }
      }
    }
  }, [user.name, setUi]);

  // Helper for conditional classNames (provided in prompt, ensuring it's not a global 'classnames' collision)
  const classes = useCallback((...args: (string | boolean | { [key: string]: boolean | undefined | null })[]) => {
    const classList: string[] = [];
    args.forEach(arg => {
      if (typeof arg === 'string' && arg.trim() !== '') {
        classList.push(arg);
      } else if (typeof arg === 'object' && arg !== null) {
        for (const key in arg) {
          if (Object.prototype.hasOwnProperty.call(arg, key) && arg[key]) {
            classList.push(key);
          }
        }
      }
    });
    return classList.join(' ');
  }, []);

  // ALL EFFECTS GO HERE

  // Effect for initializing Whop SDK and initial user/leaderboard data
  useEffect(() => {
    // Only run on the client side
    if (typeof window === 'undefined') {
      return; // Skip on SSR
    }

    // Initialize Whop SDK (assumes it's available globally after script tags load)
    if (window.whop) {
      whopRef.current = window.whop;
      
      // Set initial creator community name from window.whop if available
      setCreator(prev => ({
        ...prev,
        communityName: window.whop.community?.name || 'Demo Community',
        communityId: window.whop.community?.id || 'demo_123',
      }));

      const initializeWhopUser = async () => {
        try {
          // Attempt to get current user. If no session, it will return null or throw.
          const currentUser = await whopRef.current?.user.getCurrent();
          if (currentUser) {
            console.log("Current Whop user:", currentUser);
            userIdRef.current = currentUser.id;
            setIsAuthReady(true);
            setUser(prev => ({ ...prev, id: currentUser.id, name: currentUser.name, role: currentUser.role }));
            await fetchUserData(currentUser.id);
            await setupRealtimeLeaderboard();
            updateDailyStreak();
            updateStreakWarning();
            showToast(`Welcome back, ${currentUser.name}!`, 'success');
          } else {
            console.log("No active Whop user session. Running as guest.");
            // Fallback to guest mode
            userIdRef.current = 'guest_user';
            setUser(prev => ({
              ...prev,
              id: 'guest_user',
              name: 'Guest Player',
              xp: 1000,
              avatar_url: 'https://placehold.co/150x150/555555/FFFFFF?text=G',
              xpHistory: [{ date: new Date().toISOString().split('T')[0], xp: 1000 }],
              referralCode: null,
              referralEarnings: 0,
              referredUsers: 0,
              role: 'user'
            }));
            setIsAuthReady(false);
            setLeaderboard(prev => ({ ...prev, allTime: generateDummyLeaderboard() })); // Load dummy leaderboard for guest
          }
        } catch (error) {
          console.error("Error initializing Whop SDK user:", error);
          showToast("Failed to connect to game server. Please refresh.", "error");
          // Fallback to offline demo mode
          userIdRef.current = 'demo_user_whop_fail';
          setUser(prev => ({
            ...prev,
            id: 'demo_user_whop_fail',
            name: 'Demo Player (Offline)',
            xp: 1000,
            xpHistory: [{ date: new Date().toISOString().split('T')[0], xp: 1000 }],
            referralCode: null,
            referralEarnings: 0,
            referredUsers: 0,
            role: 'user'
          }));
          setIsAuthReady(false);
          setLeaderboard(prev => ({ ...prev, allTime: generateDummyLeaderboard() }));
        }
      };

      initializeWhopUser(); // Call immediately
      
      // Setup real-time listeners for data and leaderboard if Whop SDK supports it via `listen`
      // For simplicity, we are simulating real-time updates by re-fetching and setting the data.
      // If whop.data.listen or whop.leaderboard.listen were available, we would use them here.
      // As per the provided interface, whop.data.listen is available, let's use it for user data.
      if (whopRef.current.data.listen && userIdRef.current !== 'guest_user') {
        unsubscribeUserRef.current = whopRef.current.data.listen(`users/${userIdRef.current}/crashxp_user_data`, (data: any) => {
          if (data) {
            setUser(prev => ({
              ...prev,
              xp: data.xp || prev.xp,
              name: data.name || prev.name,
              avatar_url: data.avatar_url || prev.avatar_url,
              level: data.level || prev.level,
              totalWagered: data.totalWagered || prev.totalWagered,
              totalWon: data.totalWon || prev.totalWon,
              gamesPlayed: data.gamesPlayed || prev.gamesPlayed,
              biggestWin: data.biggestWin || prev.biggestWin,
              biggestMultiplier: data.biggestMultiplier || prev.biggestMultiplier,
              winStreak: data.winStreak || prev.winStreak,
              currentStreak: data.currentStreak || prev.currentStreak,
              lastPlayDate: data.lastPlayDate || prev.lastPlayDate,
              dailyStreak: data.dailyStreak || prev.dailyStreak,
              dailyGamesPlayed: data.dailyGamesPlayed || prev.dailyGamesPlayed,
              unlockedCosmetics: data.unlockedCosmetics ? JSON.parse(data.unlockedCosmetics) : prev.unlockedCosmetics,
              activeCosmetic: data.activeCosmetic || prev.activeCosmetic,
              xpHistory: data.xpHistory ? JSON.parse(data.xpHistory) : prev.xpHistory,
              referralCode: data.referralCode || prev.referralCode,
              referralEarnings: data.referralEarnings || prev.referralEarnings,
              referredUsers: data.referredUsers || prev.referredUsers,
              role: data.role || prev.role,
            }));
            renderXpHistoryChart();
          }
        });
      }

    } else {
      console.warn("Whop SDK not found (window.whop is undefined). Running in offline demo mode.");
      // Fallback to offline demo mode if SDK is not available
      userIdRef.current = 'demo_user_whop_sdk_missing';
      setUser(prev => ({
        ...prev,
        id: 'demo_user_whop_sdk_missing',
        name: 'Demo Player (No SDK)',
        xp: 1000,
        xpHistory: [{ date: new Date().toISOString().split('T')[0], xp: 1000 }],
        referralCode: null,
        referralEarnings: 0,
        referredUsers: 0,
        role: 'user'
      }));
      setIsAuthReady(false);
      setLeaderboard(prev => ({ ...prev, allTime: generateDummyLeaderboard() }));
    }

    // Start global features that don't strictly require authentication immediately
    generateSocialPressure();
    startRandomFOMOEvent();
    fomoEventIntervalRef.current = setInterval(startRandomFOMOEvent, 60 * 60 * 1000); // Hourly FOMO event

    // Push Notifications - Request permission (can be done in guest mode)
    if ('Notification' in window && 'serviceWorker' in navigator) {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          console.log('Notifications enabled');
        }
      });
    }

    // Cleanup function for useEffect
    return () => {
      if (multiplierIntervalRef.current) clearInterval(multiplierIntervalRef.current);
      if (socialProofIntervalIdRef.current) clearInterval(socialProofIntervalIdRef.current);
      if (fomoEventIntervalRef.current) clearInterval(fomoEventIntervalRef.current);
      if (fomoCountdownIntervalRef.current) clearInterval(fomoCountdownIntervalRef.current);
      if (dailyStreakIntervalRef.current) clearInterval(dailyStreakIntervalRef.current);
      if (streakWarningIntervalRef.current) clearInterval(streakWarningIntervalRef.current);
      if (unsubscribeUserRef.current) unsubscribeUserRef.current();
      if (unsubscribeLeaderboardRef.current) unsubscribeLeaderboardRef.current();
      if (xpHistoryChartRef.current) xpHistoryChartRef.current.destroy();
    };
  }, []);
  // Effect for updating XP history chart when ui.currentPage changes to 'stats'
  useEffect(() => {
    if (ui.currentPage === 'stats' && typeof window !== 'undefined') { // SSR Guard
      renderXpHistoryChart();
    }
  }, [ui.currentPage, renderXpHistoryChart]);

  // Effect for setting auto wager amount when the component mounts or autoPlay changes
  useEffect(() => {
    setGame(prev => ({ ...prev, userWagerXP: autoPlay.wagerAmount }));
  }, [autoPlay.wagerAmount, setGame]);

  // Effect for daily streak and streak warning intervals
  useEffect(() => {
    if (typeof window === 'undefined') return; // SSR Guard

    if (isAuthReady && user.id !== 'guest_user') {
      // Clear any existing intervals first to prevent duplicates on re-render
      if (dailyStreakIntervalRef.current) clearInterval(dailyStreakIntervalRef.current);
      if (streakWarningIntervalRef.current) clearInterval(streakWarningIntervalRef.current);

      dailyStreakIntervalRef.current = setInterval(updateDailyStreak, 24 * 60 * 60 * 1000);
      streakWarningIntervalRef.current = setInterval(updateStreakWarning, 60 * 60 * 1000);

      // Initial call on mount/auth change
      updateDailyStreak();
      updateStreakWarning();

    } else {
      // If auth state changes to not ready or guest, ensure intervals are cleared
      if (dailyStreakIntervalRef.current) clearInterval(dailyStreakIntervalRef.current);
      if (streakWarningIntervalRef.current) clearInterval(streakWarningIntervalRef.current);
    }

    return () => {
      if (dailyStreakIntervalRef.current) clearInterval(dailyStreakIntervalRef.current);
      if (streakWarningIntervalRef.current) clearInterval(streakWarningIntervalRef.current);
    };
  }, [isAuthReady, user.id, updateDailyStreak, updateStreakWarning]);

  // Effect for streak anxiety visuals and notification interval
  useEffect(() => {
    if (typeof window === 'undefined') return; // SSR Guard

    let intervalId: NodeJS.Timeout | null = null;
    const containerEl = document.querySelector('.container') as HTMLElement | null; // Cast to HTMLElement

    // Visual updates
    if (containerEl) {
      if (user.currentStreak >= 3) {
        containerEl.classList.add('streak-anxiety');
        const intensity = Math.min(0.8, 0.3 + (user.currentStreak * 0.05));
        containerEl.style.boxShadow = `0 0 ${30 + (user.currentStreak * 2)}px rgba(0, 255, 136, ${intensity})`;
      } else {
        containerEl.classList.remove('streak-anxiety');
        containerEl.style.boxShadow = '';
      }
    }

    // Notification interval
    if (isAuthReady && user.id !== 'guest_user' && user.currentStreak >= 5) {
      intervalId = setInterval(() => {
        showToast(`🚨 ${user.currentStreak} win streak! Don't break it now!`, 'warning');
        if ('Notification' in window && 'serviceWorker' in navigator && Notification.permission === 'granted') {
          new Notification('CrashXP Streak Alert! 🔥', {
            body: `Your ${user.currentStreak}-game streak is waiting! Don't let it break!`,
            icon: '/favicon.ico'
          });
        }
      }, 30000); // Every 30 seconds for demonstration, adjust to 30 * 60 * 1000 for production
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isAuthReady, user.id, user.currentStreak, showToast]);


  // ALL JSX GOES HERE
  return (
    <>
      <style jsx global>{`
        /* Define CSS Variables for the new color palette */
        :root {
            --bg-primary: #0f0f0f;
            --bg-secondary: #1a1a1a;
            --accent-green: #00ff88;
            --accent-red: #ff4757;
            --accent-blue: #3742fa;
            --text-primary: #ffffff;
            --text-muted: #8395a7;
        }

        body {
            font-family: 'Inter', sans-serif;
            /* Background Upgrade */
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%);
            background-attachment: fixed;
            color: var(--text-primary);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            overflow-x: hidden; /* Prevent horizontal scroll */
            /* Instant Polish Additions */
            text-shadow: 0 1px 2px rgba(0,0,0,0.5); /* Apply to white text */
        }

        /* Custom scrollbar for better aesthetics */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        ::-webkit-scrollbar-track {
            background: var(--bg-secondary);
            border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb {
            background: #4a5568; /* Keeping a slightly distinct color for scrollbar thumb */
            border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #6b7280;
        }

        /* Main Container Enhancement */
        .container {
            max-width: 90%;
            width: 100%;
            background: linear-gradient(145deg, #0f0f0f, #1a1a1a);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.8),
                        0 0 0 1px rgba(255, 255, 255, 0.05),
                        inset 0 1px 0 rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px);
            border-radius: 2rem; /* More rounded */
            overflow: hidden; /* Hide anything outside */
            display: flex;
            flex-direction: column;
            min-height: 90vh; /* Make it taller */
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition for all interactive elements */
            will-change: transform, opacity; /* Hardware Acceleration */
            transform: translateZ(0); /* Force hardware acceleration */
        }

        /* Multiplier Display */
        .multiplier-display {
            position: relative;
            width: 100%;
            /* Specific Fixes: Multiplier Area Background & Border */
            background: linear-gradient(145deg, var(--bg-primary), var(--bg-secondary));
            padding: 3rem 1.5rem; /* More padding */
            border: 1px solid rgba(255, 255, 255, 0.1); /* Add border */
            border-bottom: 2px solid var(--bg-secondary); /* Adjusted border color */
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            min-height: 250px; /* Ensure sufficient height */
        }

        /* Multiplier Display - The Addiction Hook */
        .multiplier-number {
            font-size: 8rem !important; /* Up from 6rem */
            font-weight: 900 !important; /* Bolder */
            background: linear-gradient(45deg, #60a5fa, #3b82f6, #60a5fa);
            background-size: 200% 200%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: gradientShift 2s ease infinite,
                       multiplierGlow 0.5s ease-in-out infinite alternate;
            text-shadow: 0 0 40px rgba(96, 165, 250, 0.8),
                         0 0 80px rgba(96, 165, 250, 0.6),
                         0 0 120px rgba(96, 165, 250, 0.4);
            letter-spacing: -0.05em;
            filter: drop-shadow(0 0 20px rgba(59, 130, 246, 0.7));
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            position: relative;
            z-index: 10;
            will-change: transform, opacity; /* Hardware Acceleration */
            transform: translateZ(0); /* Force hardware acceleration */
        }

        @keyframes multiplierGlow {
            0% { filter: brightness(1) drop-shadow(0 0 20px rgba(59, 130, 246, 0.7)); }
            100% { filter: brightness(1.3) drop-shadow(0 0 40px rgba(59, 130, 246, 1)); }
        }

        .multiplier-number.crashed {
            color: var(--accent-red); /* Red for crash */
            text-shadow: 0 0 25px rgba(239, 68, 68, 0.8);
            -webkit-text-stroke: 1px #b91c1c;
        }

        .multiplier-number.pulsing {
            animation: multiplierPulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite alternate,
                       gradientShift 2s ease infinite,
                       multiplierGlow 0.5s ease-in-out infinite alternate; /* Keep initial animations during pulsing */
        }

        @keyframes multiplierPulse {
            0% { transform: scale(1) translateZ(0); opacity: 1; }
            100% { transform: scale(1.05) translateZ(0); opacity: 0.9; }
        }

        .exploding {
            animation: crashExplode 1s ease-out forwards;
        }

        @keyframes crashExplode {
            0% { transform: translateY(0) scale(1); opacity: 1; }
            50% { transform: translateY(-50%) scale(1.5); opacity: 0; } /* Disappear quickly */
            100% { transform: translateY(-100%) scale(0.8); opacity: 0; } /* Remain invisible */
        }

        /* Danger Zone Escalation */
        .multiplier-number.danger-zone {
            background: linear-gradient(45deg, #ff6b35, #ff4757, #ff6b35);
            animation: dangerPulse 0.2s infinite, gradientShift 1s ease infinite;
            text-shadow: 0 0 50px rgba(255, 71, 87, 1),
                         0 0 100px rgba(255, 71, 87, 0.8);
            transform: scale(1.1) translateZ(0); /* Add translateZ(0) for hardware acceleration */
        }

        @keyframes dangerPulse {
            0%, 100% { transform: scale(1.1) translateZ(0); }
            50% { transform: scale(1.15) translateZ(0); filter: brightness(1.3); }
        }

        /* Jackpot Zone Escalation */
        .multiplier-number.jackpot-zone {
            background: linear-gradient(45deg, #ffd700, #ffeb3b, #ffc107);
            animation: jackpotGlow 0.1s infinite, gradientShift 0.8s ease infinite;
            text-shadow: 0 0 60px rgba(255, 215, 0, 1),
                         0 0 120px rgba(255, 215, 0, 0.8);
            transform: scale(1.2) translateZ(0); /* Add translateZ(0) for hardware acceleration */
            filter: drop-shadow(0 0 30px rgba(255, 215, 0, 1));
        }

        @keyframes jackpotGlow {
            0%, 100% { filter: brightness(1) drop-shadow(0 0 30px rgba(255, 215, 0, 1)); }
            50% { filter: brightness(1.5) drop-shadow(0 0 60px rgba(255, 215, 0, 1.2)); }
        }

        /* Streak Anxiety Visuals */
        .container.streak-anxiety {
            border: 3px solid var(--accent-green); /* Green border for streaks */
            box-shadow: 0 0 25px rgba(0, 255, 136, 0.5); /* Use accent-green */
            animation: streakGlow 1s infinite alternate;
        }
        @keyframes streakGlow {
            0%, 100% { box-shadow: 0 0 25px rgba(0, 255, 136, 0.5); } /* Use accent-green */
            50% { box-shadow: 0 0 40px rgba(0, 255, 136, 0.8); } /* Use accent-green */
        }

        /* Multiplier Chart */
        .multiplier-chart {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 100px;
            background-color: transparent;
            overflow: hidden;
            z-index: 5; /* Behind the number */
        }

        .chart-line {
            position: absolute;
            bottom: 0;
            left: 0;
            height: 5px; /* Thicker line */
            background: linear-gradient(90deg, var(--accent-green), var(--accent-blue), #8b5cf6); /* Gradient */
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            will-change: transform; /* Hardware Acceleration */
            transform: translateZ(0); /* Force hardware acceleration */
        }

        /* Card Elevation System */
        .wager-section, .action-buttons, .round-history, .autoplay-section {
            background: linear-gradient(145deg, #1a1a1a, #0f0f0f);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
                        0 0 0 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            padding: 1.5rem; /* Spacing: Change all 1rem padding -> 1.5rem */
            display: flex;
            flex-direction: column;
            gap: 1.5rem; /* Increased gap */
            align-items: center;
            will-change: transform, opacity; /* Hardware Acceleration */
            transform: translateZ(0); /* Force hardware acceleration */
        }

        .xp-balance {
            font-size: 1.5rem;
            font-weight: 700; /* Font Weights: Change 600 -> 700 */
            color: var(--accent-green); /* Green for XP */
            display: flex;
            align-items: center;
            gap: 0.5rem;
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.05));
            border: 1px solid rgba(16, 185, 129, 0.2);
            border-radius: 1rem;
            padding: 1rem 1.5rem;
            position: relative;
            overflow: hidden;
        }

        .xp-balance::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.1), transparent);
            animation: shimmer 3s ease-in-out infinite;
        }

        @keyframes shimmer {
            0% { left: -100%; }
            100% { left: 100%; }
        }


        .xp-balance svg {
            color: var(--accent-green);
        }

        .wager-input {
            display: flex;
            align-items: center;
            gap: 0.75rem; /* Increased gap */
            width: 100%;
            max-width: 350px; /* Slightly wider */
        }

        .wager-input button {
            background-color: var(--accent-blue); /* Blue for buttons */
            color: var(--text-primary);
            padding: 0.75rem 1.25rem; /* Slightly more padding */
            border-radius: 1rem; /* More rounded */
            font-size: 1.25rem;
            font-weight: 700;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.1); /* Box shadow for buttons */
            flex-shrink: 0;
            min-height: 48px; /* Ensure touch target size */
            letter-spacing: 0.02em; /* Subtle letter spacing */
        }
        .wager-input button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 12px rgba(55, 66, 250, 0.4), inset 0 1px 0 rgba(255,255,255,0.1); /* Increased hover shadow */
        }
        .wager-input button:active {
            transform: scale(0.95);
        }

        /* Input Field Enhancement */
        input[type="number"], input[type="text"] {
            background: linear-gradient(135deg, #374151, #1f2937);
            border: 2px solid rgba(255, 255, 255, 0.1);
            transition: all 0.3s ease;
            color: var(--text-primary);
            border-radius: 1rem; /* More rounded */
            padding: 0.75rem 1rem;
            font-size: 1.125rem;
            text-align: center;
            width: 100%;
            -moz-appearance: textfield; /* Hide arrows for Firefox */
            min-height: 48px; /* Ensure touch target size */
        }

        input:focus {
            border-color: rgba(59, 130, 246, 0.5);
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
            background: linear-gradient(135deg, #1f2937, #111827);
            outline: none;
        }

        /* Hide arrows for Chrome, Safari, Edge, Opera */
        .wager-input input::-webkit-outer-spin-button,
        .wager-input input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        /* Quick Wager Button Enhancement */
        .quick-wager-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            justify-content: center;
            width: 100%;
            max-width: 500px;
        }

        .quick-wager-buttons button {
            background: linear-gradient(135deg, #374151, #1f2937);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            color: var(--text-muted); /* Changed to muted text */
            padding: 0.75rem 1.25rem; /* Slightly more padding */
            border-radius: 1rem; /* More rounded */
            font-size: 0.95rem; /* Slightly larger font */
            font-weight: 700; /* Bolder text */
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255,255,255,0.05); /* Subtle box shadow for buttons */
            min-height: 48px; /* Ensure touch target size */
            letter-spacing: 0.02em;
        }

        .quick-wager-buttons button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
        }

        .quick-wager-buttons button:hover::before {
            left: 100%;
        }

        .quick-wager-buttons button:hover {
            background: linear-gradient(135deg, #60a5fa, #3b82f6);
            transform: translateY(-2px) scale(1.05);
            box-shadow: 0 8px 25px rgba(59, 130, 246, 0.4);
        }
        .quick-wager-buttons button:active {
            transform: scale(0.97);
        }

        /* Action Button Transformations */
        .place-wager-btn {
            background: linear-gradient(135deg, #00ff88, #00c950);
            font-size: 2rem !important; /* Bigger */
            padding: 1.5rem 3rem !important;
            border-radius: 1.5rem;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
            box-shadow: 0 10px 30px rgba(0, 201, 80, 0.5),
                        0 0 0 2px rgba(255, 255, 255, 0.1),
                        inset 0 1px 0 rgba(255, 255, 255, 0.2);
            transform: translateY(-2px);
            animation: pulseGreen 2s ease-in-out infinite;
            color: var(--text-primary);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            cursor: pointer;
            width: 100%;
            max-width: 400px;
            min-height: 52px; /* Ensure touch target size */
            will-change: transform, opacity; /* Hardware Acceleration */
            transform: translateZ(0); /* Force hardware acceleration */
        }

        .place-wager-btn:hover {
            background: linear-gradient(135deg, #00c950, #00ff88);
            transform: translateY(-6px) scale(1.05);
            box-shadow: 0 20px 40px rgba(0, 201, 80, 0.6);
        }
        .place-wager-btn:active {
            transform: scale(0.95);
            box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.1);
        }
        .place-wager-btn:disabled {
            opacity: 0.5;
            filter: grayscale(100%);
            cursor: not-allowed;
        }

        @keyframes pulseGreen {
            0%, 100% { box-shadow: 0 10px 30px rgba(0, 201, 80, 0.5), 0 0 0 2px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2); }
            50% { box-shadow: 0 15px 40px rgba(0, 201, 80, 0.8), 0 0 0 3px rgba(255, 255, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.3); }
        }

        .cash-out-btn {
            background: linear-gradient(135deg, #ff6b35, #ff4757);
            animation: urgentPulse 1s ease-in-out infinite;
            border: 2px solid rgba(255, 255, 255, 0.3);
            color: var(--text-primary);
            padding: 1rem 2.5rem;
            border-radius: 1rem;
            font-size: 2rem; /* Increased font size */
            font-weight: 700;
            box-shadow: 0 8px 15px rgba(0, 255, 136, 0.4), inset 0 1px 0 rgba(255,255,255,0.1); /* Button box shadow */
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            text-transform: uppercase;
            letter-spacing: 0.05em; /* Increased letter-spacing */
            cursor: pointer;
            width: 100%;
            max-width: 400px;
            min-height: 52px; /* Ensure touch target size */
            will-change: transform, opacity; /* Hardware Acceleration */
            transform: translateZ(0); /* Force hardware acceleration */
        }

        @keyframes urgentPulse {
            0%, 100% { box-shadow: 0 0 20px rgba(255, 71, 87, 0.6); }
            50% { box-shadow: 0 0 40px rgba(255, 71, 87, 1), 0 0 60px rgba(255, 71, 87, 0.4); }
        }
        .cash-out-btn:hover {
            background: linear-gradient(90deg, #34d399, var(--accent-green));
            transform: translateY(-3px) scale(1.05); /* Change hover transform */
            box-shadow: 0 12px 40px rgba(0, 255, 136, 0.4), inset 0 1px 0 rgba(255,255,255,0.1); /* Increased hover shadow */
        }
        .cash-out-btn:active {
            transform: scale(0.95);
            box-shadow: 0 4px 10px rgba(0, 255, 136, 0.3), inset 0 1px 0 rgba(255,255,255,0.1);
        }
        .cash-out-btn:disabled {
            opacity: 0.5;
            filter: grayscale(100%);
            cursor: not-allowed;
        }

        .cashed-out-display {
            background-color: var(--accent-green); /* Green for success */
            color: var(--text-primary);
            padding: 1rem 2rem;
            border-radius: 1rem;
            font-size: 1.5rem;
            font-weight: 700; /* Bolder text */
            text-align: center;
            box-shadow: 0 4px 10px rgba(0, 255, 136, 0.5); /* Use accent-green */
            backdrop-filter: blur(5px);
        }

        .crash-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 71, 87, 0.6); /* Semi-transparent red using accent-red */
            z-index: 20;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 3rem;
            font-weight: 700;
            color: var(--text-primary);
            text-shadow: 0 0 15px rgba(0, 0, 0, 0.7);
            animation: fadeInOut 1.5s forwards;
            pointer-events: none; /* Allow clicks to pass through */
        }

        @keyframes fadeInOut {
            0% { opacity: 0; }
            30% { opacity: 1; }
            70% { opacity: 1; }
            100% { opacity: 0; }
        }

        /* Round History Polish */
        .round-history {
            background: linear-gradient(145deg, #1a1a1a, #0f0f0f);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
                        0 0 0 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            padding: 1.5rem; /* Increased padding */
            border-radius: 1rem; /* More rounded */
            margin-top: 1.5rem;
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem; /* Increased gap */
            justify-content: center;
        }

        /* History Item Transformations */
        .history-item {
            position: relative;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            padding: 0.6rem 1rem; /* Increased padding */
            border-radius: 0.75rem; /* More rounded */
            font-size: 0.9rem; /* Slightly larger font */
            font-weight: 700; /* Bolder text */
            color: var(--text-primary);
            cursor: default;
            will-change: transform, opacity; /* Hardware Acceleration */
            transform: translateZ(0); /* Force hardware acceleration */
        }

        .history-item::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 2px;
            background: currentColor;
            opacity: 0.6;
        }

        .history-item.low {
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            color: #93c5fd;
        }

        .history-item.medium {
            background: linear-gradient(135deg, #d97706, #f59e0b);
            color: #fbbf24;
        }

        .history-item.high {
            background: linear-gradient(135deg, #dc2626, #ef4444);
            color: #fca5a5;
            animation: highMultiplierGlow 2s ease-in-out infinite;
        }

        @keyframes highMultiplierGlow {
            0%, 100% { box-shadow: 0 0 10px rgba(239, 68, 68, 0.5); }
            50% { box-shadow: 0 0 20px rgba(239, 68, 68, 0.8); }
        }

        .history-item.jackpot {
            background: linear-gradient(135deg, #7c3aed, #8b5cf6);
            color: #c4b5fd;
            animation: jackpotShimmer 1.5s ease-in-out infinite;
            border: 1px solid rgba(139, 92, 246, 0.5);
        }

        @keyframes jackpotShimmer {
            0%, 100% { box-shadow: 0 0 15px rgba(139, 92, 246, 0.6); }
            50% { box-shadow: 0 0 25px rgba(139, 92, 246, 1), 0 0 35px rgba(139, 92, 246, 0.4); }
        }

        /* Toast Notifications */
        .toasts-container {
            position: fixed;
            bottom: 1.5rem; /* Increased spacing */
            right: 1.5rem; /* Increased spacing */
            z-index: 100;
            display: flex;
            flex-direction: column;
            gap: 0.75rem; /* Increased gap */
            pointer-events: none; /* Allow clicks to pass through */
        }

        .toast {
            background: linear-gradient(135deg, #1f2937, #111827);
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            border-radius: 1rem;
            color: var(--text-primary);
            padding: 0.75rem 1.25rem;
            opacity: 0;
            transform: translateY(20px);
            /* Instant Polish Additions: Standardized transition already applied */
            animation: toastEnter 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards,
                       toastExit 0.5s ease-in forwards 3s;
            pointer-events: auto; /* Allow clicks on the toast if needed */
            min-width: 200px;
        }

        .toast.success {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.1));
            border-color: rgba(16, 185, 129, 0.3);
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
        }

        .toast.error {
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.1));
            border-color: rgba(239, 68, 68, 0.3);
            box-shadow: 0 0 20px rgba(239, 68, 68, 0.3);
        }
        .toast.social { background-color: var(--accent-blue); }
        .toast.warning { background-color: #f59e0b; } /* Kept existing warning color */


        @keyframes toastEnter {
            0% { opacity: 0; transform: translateY(20px); }
            100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes toastExit {
            0% { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(20px); }
        }

        /* Floating XP */
        .xp-gain-float {
            position: absolute;
            font-size: 2rem;
            font-weight: 700; /* Bolder text */
            color: var(--accent-green);
            opacity: 0;
            animation: xpFloat 2s ease-out forwards;
            pointer-events: none;
            z-index: 50;
        }

        @keyframes xpFloat {
            0% { transform: translateY(0) scale(1); opacity: 1; }
            100% { transform: translateY(-100px) scale(1.5); opacity: 0; }
        }

        /* Particle Effects */
        .particle {
            position: absolute;
            border-radius: 50%;
            width: 10px;
            height: 10px;
            opacity: 0;
            transform: scale(0);
            pointer-events: none;
            z-index: 60;
        }

        /* Modal Backdrop Enhancement */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
        }
        .modal-overlay.open {
            opacity: 1;
        }

        .modal-content {
            background: linear-gradient(145deg, #1f2937, #111827);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(20px);
            border-radius: 1.5rem;
            padding: 2rem;
            max-width: 500px;
            width: 90%;
            color: var(--text-primary);
            transform: scale(0.9);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            position: relative;
        }
        .modal-overlay.open .modal-content {
            transform: scale(1);
        }

        .modal-close-btn {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: none;
            border: none;
            font-size: 1.75rem; /* Slightly larger close button */
            color: var(--text-muted);
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
        }
        .modal-close-btn:hover {
            color: var(--accent-red);
            transform: rotate(90deg); /* Small rotation on hover */
        }

        .modal-options button {
            background-color: var(--accent-blue);
            color: var(--text-primary);
            padding: 0.75rem 1.5rem;
            border-radius: 1rem; /* More rounded */
            font-size: 1.1rem;
            font-weight: 700; /* Bolder text */
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.1); /* Box shadow for buttons */
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4, #feca57); /* Fun gradient */
            background-size: 300% 300%;
            animation: gradientShift 3s ease infinite;
            transform: scale(1);
            min-height: 48px; /* Ensure touch target size */
            letter-spacing: 0.05em; /* Increased letter-spacing */
        }
        .modal-options button:hover {
            background-color: #60a5fa;
            transform: scale(1.02); /* Adjusted scale for modal buttons */
        }
        .modal-options button:active {
            transform: scale(0.97);
        }
        .modal-options button:disabled {
            opacity: 0.5;
            filter: grayscale(100%);
            cursor: not-allowed;
        }


        /* Cosmetic Shop */
        .cosmetic-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1.5rem; /* Increased gap */
        }
        .cosmetic-item {
            background-color: var(--bg-secondary);
            border-radius: 1rem; /* More rounded */
            padding: 1.5rem; /* Increased padding */
            text-align: center;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.05); /* Card Elevation subtle shadow */
            backdrop-filter: blur(5px); /* Subtle blur */
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.75rem; /* Increased gap */
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
        }
        .cosmetic-item:hover {
            transform: scale(1.03) translateY(-4px); /* Adjusted hover effect */
            box-shadow: 0 12px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        .cosmetic-item .preview {
            font-size: 3.5rem; /* Slightly larger preview icon */
        }
        .cosmetic-item .name {
            font-weight: 700; /* Bolder text */
            font-size: 1.2rem; /* Slightly larger font */
            color: var(--text-primary);
        }
        .cosmetic-item .price {
            font-size: 1.1rem; /* Slightly larger font */
            color: var(--accent-green);
            font-weight: 700; /* Bolder text */
        }
        .cosmetic-item button {
            background-color: var(--accent-blue);
            color: var(--text-primary);
            padding: 0.6rem 1.2rem; /* Adjusted padding */
            border-radius: 0.75rem; /* More rounded */
            font-size: 1rem; /* Slightly larger font */
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            min-height: 44px; /* Ensure touch target size */
            letter-spacing: 0.02em; /* Added letter-spacing */
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.1); /* Button box shadow */
        }
        .cosmetic-item button:hover {
            background-color: #60a5fa;
            transform: translateY(-1px);
        }
        .cosmetic-item button:active {
            transform: scale(0.95);
        }
        .cosmetic-item button:disabled {
            opacity: 0.5;
            filter: grayscale(100%);
            cursor: not-allowed;
        }
        .cosmetic-item.premium .price {
            color: #8b5cf6; /* Kept existing purple for premium */
        }

        /* Leaderboard Enhancement */
        .leaderboard-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0 0.75rem; /* Increased space between rows */
        }
        .leaderboard-table th, .leaderboard-table td {
            padding: 1rem; /* Increased padding */
            text-align: left;
        }
        .leaderboard-table th {
            background-color: #374151;
            color: var(--text-muted);
            font-weight: 700; /* Bolder text */
            text-transform: uppercase;
            font-size: 0.85rem; /* Slightly larger font */
            border-radius: 0.75rem; /* Rounded headers */
        }
        .leaderboard-table th:first-child { border-top-left-radius: 0.75rem; border-bottom-left-radius: 0.75rem; }
        .leaderboard-table th:last-child { border-top-right-radius: 0.75rem; border-bottom-right-radius: 0.75rem; }

        .leaderboard-card {
            background: linear-gradient(135deg, #374151, #1f2937);
            border: 1px solid rgba(255, 255, 255, 0.08);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(5px);
        }

        .leaderboard-card:hover {
            transform: translateX(8px);
            background: linear-gradient(135deg, #1f2937, #111827);
            box-shadow: -4px 0 20px rgba(59, 130, 246, 0.2);
        }
        .leaderboard-table td {
            border-top: 1px solid #2d3748;
            border-bottom: 1px solid #2d3748;
        }
        .leaderboard-table tr:first-child td { border-top: none; }
        .leaderboard-table tr:last-child td { border-bottom: none; }

        .leaderboard-table tr.current-user {
            background-color: var(--accent-blue); /* Highlight current user */
            font-weight: 700;
            color: var(--text-primary);
            box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.1); /* Stronger highlight */
            backdrop-filter: blur(10px);
        }
        .leaderboard-table tr.current-user td {
            border-color: var(--accent-blue);
        }
        .leaderboard-table tr.current-user td:first-child { border-radius: 1rem 0 0 1rem; }
        .leaderboard-table tr.current-user td:last-child { border-radius: 0 1rem 1rem 0; }

        .leaderboard-avatar {
            width: 36px; /* Slightly larger avatar */
            height: 36px;
            border-radius: 50%;
            object-fit: cover;
            margin-right: 0.75rem; /* Increased margin */
            vertical-align: middle;
            border: 2px solid var(--accent-green); /* Add a border to avatars */
        }

        /* Stats Dashboard */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1.5rem;
            margin-top: 1.5rem;
        }
        /* Stat Card Enhancement */
        .stat-card {
            background: linear-gradient(135deg, #1f2937, #111827);
            border: 1px solid rgba(255, 255, 255, 0.08);
            transform-style: preserve-3d;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            border-radius: 1rem; /* More rounded */
            padding: 2rem; /* Increased padding */
            text-align: center;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            will-change: transform, opacity; /* Hardware Acceleration */
            transform: translateZ(0); /* Force hardware acceleration */
        }

        .stat-card:hover {
            transform: translateY(-12px) rotateX(5deg) rotateY(5deg);
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.4),
                        0 0 0 1px rgba(255, 255, 255, 0.1);
        }
        .stat-value {
            font-size: 2.75rem; /* Slightly larger font */
            font-weight: 700;
            color: var(--accent-blue);
            margin-bottom: 0.75rem; /* Increased margin */
        }
        .stat-label {
            font-size: 1.05rem; /* Slightly larger font */
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* Auto Play Controls */
        .autoplay-section {
            background-color: var(--bg-secondary);
            padding: 1.5rem;
            border-radius: 1rem; /* More rounded */
            margin-top: 1.5rem;
            /* Card Elevation */
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
        }
        .autoplay-section input[type="number"] {
            background-color: #374151;
            color: var(--text-primary);
            border: 2px solid #4a5568;
            border-radius: 1rem; /* More rounded */
            padding: 0.75rem 1rem;
            font-size: 1rem;
            width: 100%;
            max-width: 150px;
            min-height: 48px; /* Ensure touch target size */
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .autoplay-section input[type="number"]:focus {
            outline: none;
            border-color: var(--accent-blue);
            box-shadow: 0 0 0 3px rgba(55, 66, 250, 0.5); /* Add focus ring */
        }
        .autoplay-section label {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            cursor: pointer;
            color: var(--text-muted);
        }
        .autoplay-section input[type="checkbox"] {
            width: 20px;
            height: 20px;
            background-color: #4a5568;
            border-radius: 0.5rem;
            appearance: none;
            -webkit-appearance: none;
            cursor: pointer;
            position: relative;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .autoplay-section input[type="checkbox"]:checked {
            background-color: var(--accent-blue);
        }
        .autoplay-section input[type="checkbox"]:checked::after {
            content: '✔';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: var(--text-primary);
            font-size: 14px;
        }
        .autoplay-section button {
            background-color: var(--accent-blue);
            color: var(--text-primary);
            padding: 0.75rem 1.5rem;
            border-radius: 1rem; /* More rounded */
            font-weight: 700; /* Bolder text */
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            min-height: 48px; /* Ensure touch target size */
            letter-spacing: 0.02em; /* Added letter-spacing */
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.1); /* Button box shadow */
        }
        .autoplay-section button:hover {
            background-color: #60a5fa;
            transform: translateY(-2px);
        }
        .autoplay-section button:active {
            transform: scale(0.95);
        }
        .autoplay-section button:disabled {
            opacity: 0.5;
            filter: grayscale(100%);
            cursor: not-allowed;
        }

        .fun-button {
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4, #feca57);
            background-size: 300% 300%;
            animation: gradientShift 3s ease infinite;
            transform: scale(1);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.1); /* Button box shadow */
        }
        .fun-button:hover { transform: scale(1.02); } /* Adjusted scale for fun-buttons */
        .fun-button:active { transform: scale(0.97); }
        .fun-button:disabled {
            opacity: 0.5;
            filter: grayscale(100%);
            cursor: not-allowed;
        }

        @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }

        /* Fun loading animations */
        .loading-bounce {
            animation: bounce 1s infinite;
        }

        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }

        /* Sidebar Navigation Styles */
.sidebar-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(0, 0, 0, 0.7);
    z-index: 1999;
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
    backdrop-filter: blur(5px); /* Added subtle blur to sidebar backdrop */
}
.sidebar-backdrop.open {
    opacity: 1;
}

.sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: 280px; /* Slightly wider sidebar */
    /* Specific Fixes: Sidebar Background & Backdrop Filter */
    background: rgba(15, 15, 15, 0.95); /* Use primary background with opacity */
    backdrop-filter: blur(20px); /* Add blur effect */
    z-index: 2000;
    transform: translateX(-100%);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.8);
    display: flex;
    flex-direction: column;
    padding: 1.5rem; /* Increased padding */
    padding-top: 4rem;
    border-right: 1px solid rgba(255, 255, 255, 0.05); /* Subtle border */
}
.sidebar.open {
    transform: translateX(0);
}
.sidebar-item {
    display: flex;
    align-items: center;
    padding: 1rem 1.25rem; /* Increased padding */
    margin-bottom: 0.75rem; /* Increased margin */
    border-radius: 1rem; /* More rounded */
    color: var(--text-primary);
    font-weight: 700; /* Bolder text */
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
    min-height: 48px; /* Ensure touch target size */
    letter-spacing: 0.02em; /* Added letter-spacing */
    box-shadow: 0 2px 5px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.05); /* Subtle shadow for sidebar items */
}
.sidebar-item:hover {
    background-color: var(--accent-blue);
    color: var(--text-primary);
    transform: translateX(5px); /* Slide slightly on hover */
}
.sidebar-item.active {
    background-color: var(--accent-blue);
    color: var(--text-primary);
    box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.1);
}
.sidebar-item:active {
    transform: scale(0.97);
}
.sidebar-item:disabled {
    opacity: 0.5;
    filter: grayscale(100%);
    cursor: not-allowed;
}

        /* Floating Chat Bubble */
        .chat-bubble-btn {
            background-color: #8b5cf6; /* Purple color */
            color: var(--text-primary);
            padding: 1rem;
            border-radius: 9999px; /* Fully rounded */
            box-shadow: 0 8px 15px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255,255,255,0.1); /* Button box shadow */
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            cursor: pointer;
            font-size: 1.75rem; /* Larger emoji */
            display: flex;
            align-items: center;
            justify-content: center;
            width: 65px; /* Fixed size */
            height: 65px; /* Fixed size */
            animation: pulse-chat 2s infinite ease-in-out; /* Add subtle pulse animation */
        }
        .chat-bubble-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 12px 20px rgba(139, 92, 246, 0.6), inset 0 1px 0 rgba(255,255,255,0.1);
        }
        .chat-bubble-btn:active {
            transform: scale(0.95);
        }
        @keyframes pulse-chat {
            0% { transform: scale(1); box-shadow: 0 8px 15px rgba(139, 92, 246, 0.4); }
            50% { transform: scale(1.03); box-shadow: 0 10px 20px rgba(139, 92, 246, 0.6); }
            100% { transform: scale(1); box-shadow: 0 8px 15px rgba(139, 92, 246, 0.4); }
        }

        /* Chat Modal (Slide-up) */
        .chat-modal {
            position: fixed;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 80vh;
            background-color: var(--bg-secondary);
            border-top-left-radius: 1.5rem;
            border-top-right-radius: 1.5rem;
            box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.6);
            z-index: 1000;
            transform: translateY(100%);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Standardized transition */
            display: flex;
            flex-direction: column;
            padding: 1.5rem; /* Increased padding */
            overflow: hidden;
            backdrop-filter: blur(10px); /* Add blur to chat modal */
        }
        .chat-modal.open {
            transform: translateY(0);
        }
        .chat-messages {
            flex-grow: 1;
            overflow-y: auto;
            padding-right: 0.75rem; /* Increased padding */
            scrollbar-width: thin; /* Firefox scrollbar */
            scrollbar-color: #4a5568 #2d3748;
        }
        .chat-input-container {
            flex-shrink: 0;
            padding-top: 1rem;
        }
        .chat-input-container input {
            background-color: #374151;
            color: var(--text-primary);
            padding: 0.75rem 1rem;
            border-radius: 1rem; /* More rounded */
            font-size: 0.95rem;
            width: 100%;
            border: 2px solid #4a5568;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .chat-input-container input:focus {
            outline: none;
            border-color: var(--accent-blue);
            box-shadow: 0 0 0 3px rgba(55, 66, 250, 0.5); /* Add focus ring */
        }


        /* Responsive adjustments */
        @media (min-width: 768px) {
            .container {
                max-width: 750px; /* Wider on desktop */
                min-height: 90vh;
            }
            /* Adjustments for desktop - chat modal can be larger */
            .chat-modal {
                position: fixed;
                right: 1.5rem; /* Increased spacing */
                bottom: 1.5rem; /* Increased spacing */
                width: 400px; /* Wider on desktop */
                height: 550px; /* Taller on desktop */
                border-radius: 1.5rem; /* Fully rounded on corners */
                transform: translateY(0); /* Not sliding from bottom */
            }
            .chat-modal:not(.open) {
                transform: translateY(100%); /* Ensure it hides on desktop too if not open */
            }
            .sidebar-backdrop {
                display: none !important;
            }
            .sidebar {
                position: fixed;
                top: 0;
                left: 0;
                height: 100vh;
                width: 280px; /* Fixed width */
                transform: translateX(0) !important; /* Forces it to be always open on desktop */
                box-shadow: none; /* No shadow */
                border-right: 2px solid rgba(255, 255, 255, 0.05); /* Subtle border */
                display: flex !important; /* Ensure it's always visible as flex */
            }
            .main-content {
                margin-left: 280px; /* Push content to the right of sidebar */
                width: calc(100% - 280px);
            }
            .hamburger-menu-btn {
                display: none !important; /* Hide hamburger on desktop */
            }
        }

        /* Reduced Motion Support */
        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }

        /* Premium Subscription Indicator */
        .premium-glow {
            position: relative;
        }

        .premium-glow::after {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, #8b5cf6, #3b82f6, #8b5cf6);
            border-radius: inherit;
            z-index: -1;
            animation: premiumRotate 4s linear infinite;
        }

        @keyframes premiumRotate {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* FOMO Timer Enhancement */
        .fomo-timer {
            background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(124, 58, 237, 0.1));
            border: 2px solid rgba(139, 92, 246, 0.4);
            box-shadow: 0 0 30px rgba(139, 92, 246, 0.3);
            animation: fomoUrgent 1s ease-in-out infinite;
            padding: 3px; /* Ensure padding is not overwritten */
            border-radius: 6px; /* Ensure border-radius is not overwritten */
            margin-bottom: 16px; /* Ensure margin is not overwritten */
            margin-left: auto; /* Ensure centering is not overwritten */
            margin-right: auto; /* Ensure centering is not overwritten */
            max-width: 256px; /* Ensure max-width is not overwritten */
        }

        @keyframes fomoUrgent {
            0%, 100% { border-color: rgba(139, 92, 246, 0.4); }
            50% { border-color: rgba(139, 92, 246, 0.8); }
        }
      `}</style>

      {/* Hamburger Menu Button */}
      <button
        onClick={toggleSidebar}
        className="hamburger-menu-btn fixed top-4 left-4 z-[2001] bg-gray-700 text-white p-3 rounded-full shadow-lg hover:scale-105 transition md:hidden"
        style={{ minHeight: '48px', minWidth: '48px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
      >
        ☰
      </button>

      {/* Sidebar Backdrop */}
      {ui.showSidebar && (
        <div
          className="sidebar-backdrop md:hidden"
          onClick={() => setUi(prev => ({ ...prev, showSidebar: false }))}
        ></div>
      )}

      {/* Sidebar Navigation */}
      <div className={classes('sidebar', { 'open': ui.showSidebar })}>
        <h2 className="text-2xl font-bold text-gray-100 mb-6 px-4">CrashXP</h2>
        <button
          onClick={() => navigate('game')}
          className={classes('sidebar-item', { 'active': ui.currentPage === 'game' })}
        >
          🎮 Game
        </button>
        <button
          onClick={() => navigate('stats')}
          className={classes('sidebar-item', { 'active': ui.currentPage === 'stats' })}
        >
          📊 Stats
        </button>
        <button
          onClick={() => navigate('leaderboard')}
          className={classes('sidebar-item', { 'active': ui.currentPage === 'leaderboard' })}
        >
          🏆 Leaderboard
        </button>
        <button
          onClick={() => navigate('premium')}
          className={classes('sidebar-item', { 'active': ui.currentPage === 'premium' })}
        >
          ⭐ Premium
        </button>
        <button
          onClick={() => navigate('settings')}
          className={classes('sidebar-item', { 'active': ui.currentPage === 'settings' })}
        >
          ⚙️ Settings
        </button>
        {!isAuthReady || user.id === 'guest_user' ? (
          <button
            onClick={showSignInOptions}
            className="sidebar-item"
          >
            🔑 Sign In
          </button>
        ) : (
          <button
            onClick={() => showModal({ title: 'Logout', message: 'Are you sure you want to log out?', options: [{ text: 'Yes', action: () => { if(whopRef.current) whopRef.current.user.signOut(); window.location.reload(); } }, { text: 'No', action: () => { closeModal(); } }] })}
            className="sidebar-item mt-auto"
          >
            ➡️ Logout
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className={classes('container relative main-content', { 'streak-anxiety': user.currentStreak >= 3 })}>
        {/* Creator Debug Banner (Optional) */}
        {user.role === 'creator' && user.id !== 'guest_user' && (
          <div className="absolute top-2 right-2 bg-yellow-500 text-yellow-900 px-3 py-1 rounded-full text-xs font-bold z-10">
            VIEWING AS CREATOR
          </div>
        )}

        {/* Main Game Page */}
        {ui.currentPage === 'game' && (
          <div className="flex flex-col flex-grow">
            {/* TASK 8: FOMO Countdown Display */}
            {ui.activeFomoEventMessage && (
              <div
                className="fomo-timer bg-purple-600 text-white p-3 rounded-lg text-center font-semibold mb-4 mx-auto max-w-sm"
                style={{ boxShadow: '0 4px 15px rgba(139, 92, 246, 0.4)', backdropFilter: 'blur(5px)' }}
              >
                {ui.activeFomoEventMessage}
              </div>
            )}

            {/* FEATURE 5: Tournament Banner */}
            <div
              className="tournament-banner bg-purple-600 p-3 text-white text-center mb-4 rounded-lg mx-4"
              style={{ boxShadow: '0 4px 15px rgba(139, 92, 246, 0.4)', backdropFilter: 'blur(5px)' }}
            >
              🏆 Weekly Tournament: Top 10 players split 10,000 XP prize pool!
              <div className="text-sm">Ends in: <span className="font-mono">2d 14h 23m</span></div>
            </div>

            {/* Multiplier Display */}
            <div className="multiplier-display relative">
              <div
                className={classes('multiplier-number', {
                  'pulsing': game.isRunning,
                  'crashed': game.isCrashed,
                  'exploding': game.isExploding,
                  'danger-zone': game.currentMultiplier >= 1.5 && game.currentMultiplier < 5.0,
                  'jackpot-zone': game.currentMultiplier >= 5.0
                })}
              >
                {game.currentMultiplier.toFixed(2)}x
              </div>
              {/* Multiplier Chart (simple visual representation) */}
              <div className="multiplier-chart">
                <div
                  className="chart-line"
                  style={{
                    width: `${(game.currentMultiplier / (game.crashPoint || 50)) * 100}%`,
                    transform: `translateX(-${(1 - (game.currentMultiplier / (game.crashPoint || 50))) * 100}%)`
                  }}
                ></div>
              </div>
              {/* Crash Overlay */}
              {game.isCrashed && !game.userCashedOut && (
                <div className="crash-overlay">
                  CRASHED!
                </div>
              )}
            </div>

            {/* Wager Controls */}
            <div className="wager-section">
              <div className="xp-balance">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M12 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
                  <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3A5.25 5.25 0 0 0 12 1.5Zm7.5 10.5a3 3 0 0 1 3 3v6.75a3 3 0 0 1-3 3h-10.5a3 3 0 0 1-3-3v-6.75a3 3 0 0 1 3-3h10.5Z" clipRule="evenodd" />
                </svg>
                <span>{user.xp.toLocaleString()}</span> XP
              </div>
              <div className="wager-input">
                <button onClick={decreaseWager} className="flex-grow-0">-</button>
                <input
                  type="number"
                  value={game.userWagerXP}
                  min="10"
                  step="10"
                  onChange={(e) => setGame(prev => ({ ...prev, userWagerXP: Math.max(10, Math.floor(parseInt(e.target.value) / 10) * 10) }))}
                  className="flex-grow text-center ring-2 ring-blue-500/20"
                />
                <button onClick={increaseWager} className="flex-grow-0">+</button>
              </div>
              <div className="quick-wager-buttons">
                <button onClick={() => setWager(50)}>50 XP</button>
                <button onClick={() => setWager(100)}>100 XP</button>
                <button onClick={() => setWager(250)}>250 XP</button>
                <button onClick={() => setWager(Math.floor(user.xp * 0.5 / 10) * 10)}>Half</button>
                <button onClick={() => setWager(Math.floor(user.xp / 10) * 10)}>All In</button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="action-buttons">
              {game.isWaiting && (
                <button
                  onClick={placeWager}
                  disabled={game.userWagerXP <= 0 || game.userWagerXP > user.xp || ui.isCalculatingRound}
                  className={classes('place-wager-btn transform transition-all duration-300', {
                    'opacity-50 cursor-not-allowed': game.userWagerXP <= 0 || game.userWagerXP > user.xp || ui.isCalculatingRound
                  })}
                >
                  {ui.isCalculatingRound ? 'Loading...' : 'PLACE WAGER'}
                </button>
              )}

              {game.isRunning && !game.userCashedOut && (
                <button
                  onClick={cashOut}
                  className={classes('cash-out-btn transform transition-all duration-300', {
                    'ring-2 ring-green-400 ring-offset-2 ring-offset-green-700': game.isRunning && !game.userCashedOut
                  })}
                  disabled={!game.isRunning || game.userCashedOut}
                >
                  CASH OUT at {game.currentMultiplier.toFixed(2)}x
                </button>
              )}

              {!game.isRunning && game.userCashedOut && (
                <div className="cashed-out-display !bg-green-600">
                  You cashed out at {(game.userCashOutMultiplier || 0).toFixed(2)}x! Won {game.userWinningsXP.toLocaleString()} XP
                </div>
              )}
              {!game.isRunning && game.isCrashed && !game.userCashedOut && (
                <div className="cashed-out-display !bg-red-600">
                  You lost {game.userWagerXP.toLocaleString()} XP!
                </div>
              )}
            </div>

            {/* Round History */}
            <div className="p-4 flex-grow overflow-y-auto">
              <h3 className="text-xl font-semibold mb-3 text-center text-gray-300">Last 10 Rounds</h3>
              <div className="round-history">
                {game.lastRounds.map((crashPoint, index) => (
                  <span
                    key={index}
                    className={classes('history-item', {
                      'low': crashPoint < 1.5,
                      'medium': crashPoint >= 1.5 && crashPoint < 3.0,
                      'high': crashPoint >= 3.0 && crashPoint < 10.0,
                      'jackpot': crashPoint >= 10.0
                    })}
                  >
                    {crashPoint.toFixed(2)}x
                  </span>
                ))}
              </div>

              {/* Auto-Play Controls */}
              <div className="autoplay-section mt-6 p-4 rounded-xl shadow-lg">
                <h3 className="text-xl font-semibold mb-4 text-gray-300">Auto-Play Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <label htmlFor="auto-wager" className="text-gray-300">Wager:</label>
                    <input
                      type="number"
                      id="auto-wager"
                      value={autoPlay.wagerAmount}
                      min="10"
                      step="10"
                      onChange={(e) => setAutoPlay(prev => ({ ...prev, wagerAmount: parseInt(e.target.value) }))}
                      className="w-full ring-2 ring-blue-500/20"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="auto-cashout" className="text-gray-300">Cash Out At:</label>
                    <input
                      type="number"
                      id="auto-cashout"
                      value={autoPlay.cashOutAt}
                      min="1.01"
                      step="0.01"
                      onChange={(e) => setAutoPlay(prev => ({ ...prev, cashOutAt: parseFloat(e.target.value) }))}
                      className="w-full ring-2 ring-blue-500/20"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer flex items-center gap-2 text-gray-300">
                      <input
                        type="checkbox"
                        checked={game.autoCashOut}
                        onChange={(e) => setGame(prev => ({ ...prev, autoCashOut: e.target.checked }))}
                      /> Enable Auto Cash Out (Uses Auto Cash Out At)
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer flex items-center gap-2 text-gray-300">
                      <input
                        type="checkbox"
                        checked={autoPlay.stopOnWin}
                        onChange={(e) => setAutoPlay(prev => ({ ...prev, stopOnWin: e.target.checked }))}
                      /> Stop on Win
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer flex items-center gap-2 text-gray-300">
                      <input
                        type="checkbox"
                        checked={autoPlay.stopOnLoss}
                        onChange={(e) => setAutoPlay(prev => ({ ...prev, stopOnLoss: e.target.checked }))}
                      /> Stop on Loss
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="max-rounds" className="text-gray-300">Max Rounds:</label>
                    <input
                      type="number"
                      id="max-rounds"
                      value={autoPlay.maxRounds}
                      min="1"
                      step="1"
                      onChange={(e) => setAutoPlay(prev => ({ ...prev, maxRounds: parseInt(e.target.value) }))}
                      className="w-full ring-2 ring-blue-500/20"
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-center gap-4">
                  {!autoPlay.enabled ? (
                    <button onClick={autoPlayStart} className="px-5 py-2 transform transition-all duration-300">Start Auto Play</button>
                  ) : (
                    <button onClick={autoPlayStop} className="px-5 py-2 !bg-red-500 transform transition-all duration-300">Stop Auto Play</button>
                  )}
                </div>
                {autoPlay.enabled && (
                  <p className="text-sm text-center text-gray-400 mt-2">Auto playing round <span>{autoPlay.currentRound}</span> of <span>{autoPlay.maxRounds}</span>.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stats Dashboard */}
        {ui.currentPage === 'stats' && (
          <div className="p-4 flex-grow overflow-y-auto">
            <h2 className="text-3xl font-bold text-center text-gray-100 mb-6">Your Crash Stats</h2>

            {/* FEATURE 4: Viral Referral System HTML */}
            <div
              className="referral-section bg-purple-600 p-4 rounded-xl mb-4"
              style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(10px)' }}
            >
              <h3 className="text-white font-bold text-xl">🤝 Refer Friends</h3>
              <p className="text-purple-100 mb-3">Get 100 XP for every friend who plays 5+ games!</p>
              <button
                onClick={copyReferralLink}
                disabled={!isAuthReady || user.id === 'guest_user'}
                className="bg-yellow-400 text-purple-900 px-4 py-2 rounded font-bold transform transition-all duration-300"
              >
                Copy Referral Link
              </button>
              <div className="mt-2 text-purple-100">
                Referred: <span>{user.referredUsers}</span> users •
                Earned: <span>{user.referralEarnings}</span> XP
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{user.gamesPlayed}</div>
                <div className="stat-label">Games Played</div>
              </div>

              <div className="stat-card">
                <div className="stat-value">{(user.gamesPlayed > 0 ? ((user.totalWon / user.totalWagered) * 100).toFixed(1) : 0) + '%'}</div>
                <div className="stat-label">Win Rate</div>
              </div>

              <div className="stat-card">
                <div className="stat-value">{user.biggestMultiplier.toFixed(2)}x</div>
                <div className="stat-label">Biggest Multiplier</div>
              </div>

              <div className="stat-card">
                <div
                  className={classes('stat-value', {
                    'text-green-500': user.totalWon - user.totalWagered > 0,
                    'text-red-500': user.totalWon - user.totalWagered < 0
                  })}
                >
                  {(user.totalWon - user.totalWagered > 0 ? '+' : '') + (user.totalWon - user.totalWagered).toLocaleString()}
                </div>
                <div className="stat-label">Profit/Loss</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{user.winStreak}</div>
                <div className="stat-label">Longest Win Streak</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{user.dailyStreak}</div>
                <div className="stat-label">Daily Streak</div>
              </div>
            </div>

            {/* Charts would go here */}
            <div
              className="chart-container mt-8 p-4 bg-gray-800 rounded-xl shadow-lg"
              style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(10px)' }}
            >
              <h3 className="text-xl font-semibold mb-4 text-gray-300">XP History</h3>
              <canvas id="xpHistoryChart" className="w-full h-64"></canvas>
            </div>
          </div>
        )}

        {/* Leaderboard Page */}
        {ui.currentPage === 'leaderboard' && (
          <div className="p-4 flex-grow overflow-y-auto">
            <h2 className="text-3xl font-bold text-center text-gray-100 mb-6">Leaderboard</h2>

            <div
              className="bg-gray-800 p-4 rounded-xl shadow-lg"
              style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(10px)' }}
            >
              <h3 className="text-xl font-semibold mb-4 text-gray-300">Top Players (All Time)</h3>
              <div className="leaderboard-mobile space-y-3">
                {leaderboard.allTime.map((player, index) => (
                  <div
                    key={player.id}
                    className={classes('leaderboard-card bg-gray-700 rounded-xl p-4 flex items-center justify-between', {
                      'ring-2 ring-blue-500 bg-blue-600': player.isCurrentUser
                    })}
                    style={{ boxShadow: '0 4px 10px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(5px)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="rank-circle w-9 h-9 bg-gray-600 rounded-full flex items-center justify-center text-base font-bold">
                        {index + 1}
                      </div>
                      <img src={player.avatar} className="w-10 h-10 rounded-full border-2 border-green-400" alt="avatar" />
                      <div>
                        <div className="font-semibold text-white">{player.name}</div>
                        <div className="text-xs text-gray-400">{player.gamesPlayed} games</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-yellow-400">{player.xp.toLocaleString()}</div>
                      <div className="text-xs text-gray-400">{player.biggestMultiplier}x best</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* FEATURE 2: Creator Revenue Dashboard */}
        {ui.currentPage === 'creator' && user.role === 'creator' && user.id !== 'guest_user' && (
          <div className="p-4 flex-grow overflow-y-auto">
            <div
              className="creator-earnings bg-green-600 p-4 rounded-xl mb-4"
              style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(10px)' }}
            >
              <h3 className="text-white font-bold text-xl">💰 Your Earnings</h3>
              <div className="text-3xl font-bold text-white">${creator.monthlyEarnings.toFixed(2)}<span className="text-sm text-gray-300">/month</span></div>
              <div className="text-green-100">From <span>{creator.activeUsers}</span> active players</div>
              <div className="text-green-100">Revenue Share: 70% • Platform Fee: 3%</div>
            </div>

            {/* FEATURE 9: Analytics Dashboard for Creators */}
            <div
              className="analytics-section bg-gray-800 p-4 rounded-xl mb-4"
              style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(10px)' }}
            >
              <h3 className="text-xl font-semibold text-gray-200 mb-4">📊 Analytics</h3>
              <div className="analytics-grid grid grid-cols-2 md:grid-cols-4 gap-4">
                <div
                  className="metric bg-gray-700 p-3 rounded text-center"
                  style={{ boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)', backdropFilter: 'blur(5px)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
                >
                  <div className="text-2xl font-bold text-blue-400">7-9 PM</div>
                  <div className="text-xs text-gray-400">Peak Hours</div>
                </div>
                <div
                  className="metric bg-gray-700 p-3 rounded text-center"
                  style={{ boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)', backdropFilter: 'blur(5px)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
                >
                  <div className="text-2xl font-bold text-green-400">34 min</div>
                  <div className="text-xs text-gray-400">Avg Session</div>
                </div>
                <div
                  className="metric bg-gray-700 p-3 rounded text-center"
                  style={{ boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)', backdropFilter: 'blur(5px)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
                >
                  <div className="text-2xl font-bold text-purple-400">18%</div>
                  <div className="text-xs text-gray-400">Conversion Rate</div>
                </div>
                <div
                  className="metric bg-gray-700 p-3 rounded text-center"
                  style={{ boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)', backdropFilter: 'blur(5px)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
                >
                  <div className="text-2xl font-bold text-yellow-400">85%</div>
                  <div className="text-xs text-gray-400">Retention Rate</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Global Modals */}
        {ui.modal.show && (
          <div
            className={classes('modal-overlay', { 'open': ui.modal.show })}
          >
            <div
              className="modal-content"
            >
              <button onClick={closeModal} className="modal-close-btn">&times;</button>
              <h2 className="text-2xl font-bold text-gray-100 mb-4">{ui.modal.title}</h2>
              <p className="text-gray-300 mb-6" dangerouslySetInnerHTML={{ __html: ui.modal.message }}></p>
              <div className="modal-options flex flex-wrap justify-center gap-4">
                {ui.modal.options.map((option, index) => (
                  <button key={index} onClick={() => { option.action(); }} className="transform transition-all duration-300">
                    {option.text}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PREMIUM Modal - Unified for Subscriptions, Cosmetics, and Boosts */}
        {ui.showSubscriptions && (
          <div
            className={classes('modal-overlay', { 'open': ui.showSubscriptions })}
          >
            <div
              className="modal-content !max-w-md !w-11/12 !max-h-[90vh] !overflow-y-auto !p-4"
            >
              <button onClick={() => { setUi(prev => ({ ...prev, showSubscriptions: false, currentPage: 'game' })); }} className="modal-close-btn">&times;</button>
              <h2 className="text-2xl font-bold text-center text-gray-100 mb-4">⭐ Premium Features</h2>

              {/* Tab Navigation for Premium Modal */}
              <div className="flex justify-center mb-4">
                <button
                  onClick={() => setUi(prev => ({ ...prev, premiumTab: 'subscriptions' }))}
                  className={classes('px-3 py-2 rounded-l-lg font-semibold transition text-sm flex-1', {
                    'bg-blue-600 text-white': ui.premiumTab === 'subscriptions',
                    'bg-gray-700 text-gray-300': ui.premiumTab !== 'subscriptions'
                  })}
                >
                  Subs
                </button>
                <button
                  onClick={() => setUi(prev => ({ ...prev, premiumTab: 'cosmetics' }))}
                  className={classes('px-3 py-2 font-semibold transition text-sm flex-1', {
                    'bg-blue-600 text-white': ui.premiumTab === 'cosmetics',
                    'bg-gray-700 text-gray-300': ui.premiumTab !== 'cosmetics'
                  })}
                >
                  Cosmetics
                </button>
                <button
                  onClick={() => setUi(prev => ({ ...prev, premiumTab: 'boosts' }))}
                  className={classes('px-3 py-2 rounded-r-lg font-semibold transition text-sm flex-1', {
                    'bg-blue-600 text-white': ui.premiumTab === 'boosts',
                    'bg-gray-700 text-gray-300': ui.premiumTab !== 'boosts'
                  })}
                >
                  Boosts
                </button>
              </div>

              {/* Subscriptions Tab Content */}
              {ui.premiumTab === 'subscriptions' && (
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-gray-200 mb-3 text-center">Unlock More Perks!</h3>
                  <div className="space-y-3">
                    {/* Bronze */}
                    <div className="bg-gray-700 p-3 rounded-lg text-center border border-yellow-500">
                      <h3 className="text-lg font-bold text-yellow-400 mb-1">Bronze</h3>
                      <div className="text-2xl font-bold text-white">$4.99<span className="text-sm text-gray-300">/mo</span></div>
                      <div className="text-xs text-gray-300 mt-2 space-y-1">
                        <div>✓ 1.2x XP Multiplier</div>
                        <div>✓ 2x Daily Bonus</div>
                      </div>
                      <button className="bg-yellow-500 text-black px-4 py-2 rounded mt-3 font-bold text-sm w-full">Subscribe</button>
                    </div>

                    {/* Silver */}
                    <div className="bg-gray-700 p-3 rounded-lg text-center border-2 border-blue-500">
                      <div className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full mb-2 inline-block">POPULAR</div>
                      <h3 className="text-lg font-bold text-blue-400 mb-1">Silver</h3>
                      <div className="text-2xl font-bold text-white">$9.99<span className="text-sm text-gray-300">/mo</span></div>
                      <div className="text-xs text-gray-300 mt-2 space-y-1">
                        <div>✓ 1.5x XP Multiplier</div>
                        <div>✓ 3x Daily Bonus</div>
                        <div>✓ Exclusive Cosmetics</div>
                      </div>
                      <button className="bg-blue-500 text-white px-4 py-2 rounded mt-3 font-bold text-sm w-full">Subscribe</button>
                    </div>

                    {/* Gold */}
                    <div className="bg-gray-700 p-3 rounded-lg text-center border border-purple-500">
                      <h3 className="text-lg font-bold text-purple-400 mb-1">Gold</h3>
                      <div className="text-2xl font-bold text-white">$19.99<span className="text-sm text-gray-300">/mo</span></div>
                      <div className="text-xs text-gray-300 mt-2 space-y-1">
                        <div>✓ 2x XP Multiplier</div>
                        <div>✓ 5x Daily Bonus</div>
                        <div>✓ VIP Chat Access</div>
                        <div>✓ Early Feature Access</div>
                      </div>
                      <button className="bg-purple-500 text-white px-4 py-2 rounded mt-3 font-bold text-sm w-full">Subscribe</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Cosmetics Tab Content */}
              {ui.premiumTab === 'cosmetics' && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-200 mb-3 text-center">Personalize Your CrashXP!</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className={classes('cosmetic-item', { 'opacity-50 cursor-not-allowed': user.unlockedCosmetics.includes('golden_ring') })}>
                      <div className="preview">🟡</div>
                      <div className="name">Golden Ring</div>
                      <div className="price">500 XP</div>
                      <button
                        onClick={() => buyCosmetic('golden_ring', 500)}
                        disabled={!isAuthReady || user.id === 'guest_user' || user.unlockedCosmetics.includes('golden_ring')}
                        className="fun-button transform transition-all duration-300"
                      >
                        {(!isAuthReady || user.id === 'guest_user') ? 'Sign In to Buy' : (user.unlockedCosmetics.includes('golden_ring') ? 'Owned' : 'Buy')}
                      </button>
                    </div>
                    <div className={classes('cosmetic-item premium', { 'opacity-50 cursor-not-allowed': user.unlockedCosmetics.includes('diamond_ring') })}>
                      <div className="preview">💎</div>
                      <div className="name">Diamond Ring</div>
                      <div className="price">$2.99</div>
                      <button
                        onClick={() => buyPremiumCosmetic('diamond_ring')}
                        disabled={!isAuthReady || user.id === 'guest_user' || user.unlockedCosmetics.includes('diamond_ring')}
                        className="fun-button transform transition-all duration-300"
                      >
                        {(!isAuthReady || user.id === 'guest_user') ? 'Sign In to Buy' : (user.unlockedCosmetics.includes('diamond_ring') ? 'Owned' : 'Buy')}
                      </button>
                    </div>
                    <div className={classes('cosmetic-item', { 'opacity-50 cursor-not-allowed': user.unlockedCosmetics.includes('rainbow_aura') })}>
                      <div className="preview">🌈</div>
                      <div className="name">Rainbow Aura</div>
                      <div className="price">1500 XP</div>
                      <button
                        onClick={() => buyCosmetic('rainbow_aura', 1500)}
                        disabled={!isAuthReady || user.id === 'guest_user' || user.unlockedCosmetics.includes('rainbow_aura')}
                        className="fun-button transform transition-all duration-300"
                      >
                        {(!isAuthReady || user.id === 'guest_user') ? 'Sign In to Buy' : (user.unlockedCosmetics.includes('rainbow_aura') ? 'Owned' : 'Buy')}
                      </button>
                    </div>
                    <div className={classes('cosmetic-item', { 'opacity-50 cursor-not-allowed': user.unlockedCosmetics.includes('fire_explosion') })}>
                      <div className="preview">🔥</div>
                      <div className="name">Fire Explosion</div>
                      <div className="price">750 XP</div>
                      <button
                        onClick={() => buyCosmetic('fire_explosion', 750)}
                        disabled={!isAuthReady || user.id === 'guest_user' || user.unlockedCosmetics.includes('fire_explosion')}
                        className="fun-button transform transition-all duration-300"
                      >
                        {(!isAuthReady || user.id === 'guest_user') ? 'Sign In to Buy' : (user.unlockedCosmetics.includes('fire_explosion') ? 'Owned' : 'Buy')}
                      </button>
                    </div>
                    <div className={classes('cosmetic-item', { 'opacity-50 cursor-not-allowed': user.unlockedCosmetics.includes('electric_shock') })}>
                      <div className="preview">⚡</div>
                      <div className="name">Electric Shock</div>
                      <div className="price">1000 XP</div>
                      <button
                        onClick={() => buyCosmetic('electric_shock', 1000)}
                        disabled={!isAuthReady || user.id === 'guest_user' || user.unlockedCosmetics.includes('electric_shock')}
                        className="fun-button transform transition-all duration-300"
                      >
                        {(!isAuthReady || user.id === 'guest_user') ? 'Sign In to Buy' : (user.unlockedCosmetics.includes('electric_shock') ? 'Owned' : 'Buy')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Boosts Tab Content */}
              {ui.premiumTab === 'boosts' && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-200 mb-3 text-center">Supercharge Your XP!</h3>
                  <div className="space-y-3">
                    <div
                      className="boost-item bg-white bg-opacity-20 p-3 rounded-lg text-center"
                      style={{ boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)', backdropFilter: 'blur(5px)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
                    >
                      <div className="boost-icon text-3xl mb-2">🚀</div>
                      <div className="boost-name text-white font-semibold">2x Weekend Boost</div>
                      <div className="boost-price text-yellow-300 font-bold">$2.99</div>
                      <button
                        onClick={() => purchaseXPBoost('2x_weekend')}
                        disabled={!isAuthReady || user.id === 'guest_user'}
                        className="mt-2 bg-yellow-400 text-orange-900 px-3 py-1 rounded font-semibold transform transition-all duration-300"
                      >
                        {(!isAuthReady || user.id === 'guest_user') ? 'Sign In to Buy' : 'Buy Now'}
                      </button>
                    </div>
                    <div
                      className="boost-item bg-white bg-opacity-20 p-3 rounded-lg text-center"
                      style={{ boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)', backdropFilter: 'blur(5px)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
                    >
                      <div className="boost-icon text-3xl mb-2">⚡</div>
                      <div className="boost-name text-white font-semibold">3x Power Hour</div>
                      <div className="boost-price text-yellow-300 font-bold">$1.99</div>
                      <button
                        onClick={() => purchaseXPBoost('3x_hour')}
                        disabled={!isAuthReady || user.id === 'guest_user'}
                        className="mt-2 bg-yellow-400 text-orange-900 px-3 py-1 rounded font-semibold transform transition-all duration-300"
                      >
                        {(!isAuthReady || user.id === 'guest_user') ? 'Sign In to Buy' : 'Buy Now'}
                      </button>
                    </div>
                    <div
                      className="boost-item bg-white bg-opacity-20 p-3 rounded-lg text-center"
                      style={{ boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)', backdropFilter: 'blur(5px)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
                    >
                      <div className="boost-icon text-3xl mb-2">🍀</div>
                      <div className="boost-name text-white font-semibold">5x Lucky Strike</div>
                      <div className="boost-price text-yellow-300 font-bold">$4.99</div>
                      <button
                        onClick={() => purchaseXPBoost('5x_lucky')}
                        disabled={!isAuthReady || user.id === 'guest_user'}
                        className="mt-2 bg-yellow-400 text-orange-900 px-3 py-1 rounded font-semibold transform transition-all duration-300"
                      >
                        {(!isAuthReady || user.id === 'guest_user') ? 'Sign In to Buy' : 'Buy Now'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings Modal */}
        {ui.showSettings && (
          <div
            className={classes('modal-overlay', { 'open': ui.showSettings })}
          >
            <div
              className="modal-content"
            >
              <button onClick={() => setUi(prev => ({ ...prev, showSettings: false }))} className="modal-close-btn">&times;</button>
              <h2 className="text-2xl font-bold text-center text-gray-100 mb-6">Settings</h2>

              <div className="flex flex-col gap-4">
                <label className="flex items-center justify-between cursor-pointer text-gray-300">
                  <span>Sound Effects</span>
                  <input
                    type="checkbox"
                    checked={ui.soundEnabled}
                    onChange={(e) => setUi(prev => ({ ...prev, soundEnabled: e.target.checked }))}
                    className="transform transition-all duration-300"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer text-gray-300">
                  <span>Vibration (Haptic Feedback)</span>
                  <input
                    type="checkbox"
                    checked={ui.vibrationEnabled}
                    onChange={(e) => setUi(prev => ({ ...prev, vibrationEnabled: e.target.checked }))}
                    className="transform transition-all duration-300"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer text-gray-300">
                  <span>Animations</span>
                  <input
                    type="checkbox"
                    checked={ui.animationsEnabled}
                    onChange={(e) => setUi(prev => ({ ...prev, animationsEnabled: e.target.checked }))}
                    className="transform transition-all duration-300"
                  />
                </label>
                <div className="text-gray-400 text-sm mt-2">
                  Your User ID: <span className="font-mono text-xs break-all">{user.id}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mystery Box Modal */}
        {ui.showMysteryBox && (
          <div
            className={classes('modal-overlay', { 'open': ui.showMysteryBox })}
          >
            <div
              className="modal-content text-center"
            >
              <button onClick={() => { closeModal(); setUi(prev => ({ ...prev, showMysteryBox: false })); }} className="modal-close-btn">&times;</button>
              <h2 className="text-3xl font-bold text-gray-100 mb-4">Mystery Box!</h2>
              <div className="text-6xl mb-6 animate-pulse">🎁</div>
              {!ui.isCalculatingRound ? (
                <p className="text-gray-300 text-lg mb-6">{ui.modal.message || 'Opening...'}</p>
              ) : (
                <p className="text-gray-300 text-lg mb-6">Opening your Mystery Box...</p>
              )}
              {!ui.isCalculatingRound && (
                <div className="modal-options flex justify-center">
                  <button onClick={() => { closeModal(); setUi(prev => ({ ...prev, showMysteryBox: false })); }} className="fun-button transform transition-all duration-300">Claim Reward!</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Toasts Container */}
        <div className="toasts-container">
          {ui.toasts.map((toast) => (
            <div key={toast.id} className={classes('toast', toast.type)}>
              <span>{toast.message}</span>
            </div>
          ))}
        </div>

        {/* Floating Chat Button */}
        <div className="fixed bottom-4 right-4 z-50 md:right-auto md:left-auto md:bottom-auto md:top-auto">
          <button onClick={toggleChat} className="chat-bubble-btn">
            💬
          </button>
        </div>

        {/* Chat Modal (Slide-up) */}
        {ui.showCommunityChat && (
          <div
            className={classes('chat-modal', { 'open': ui.showCommunityChat })}
          >
            <div className="flex justify-between items-center mb-3 flex-shrink-0">
              <h4 className="text-white font-bold text-xl">💬 Community Chat</h4>
              <button onClick={toggleChat} className="text-gray-400 hover:text-white text-xl font-bold transform transition-all duration-300">
                ✕
              </button>
            </div>
            <div className="chat-messages mb-3 space-y-2">
              {ui.messages.map((msg) => (
                <div key={msg.id} className="text-sm">
                  <span className="text-blue-400 font-semibold">{msg.user}</span>:
                  <span className="text-gray-300">{msg.text}</span>
                </div>
              ))}
            </div>
            <div className="chat-input-container">
              <input
                type="text"
                placeholder="Say something..."
                className="w-full bg-gray-700 text-white p-2 rounded text-sm ring-2 ring-blue-500/20"
                onKeyUp={handleChatMessage}
              />
            </div>
          </div>
        )}
      </div>

      {/* External Scripts - Loaded using Next.js Script component */}
      <Script src="https://cdn.tailwindcss.com" strategy="afterInteractive" />
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" strategy="afterInteractive" />
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js" strategy="afterInteractive" />
      <Script src="https://cdn.jsdelivr.net/npm/chart.js" strategy="afterInteractive" />
      <Script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-moment@1.0.0/dist/chartjs-adapter-moment@1.0.0.min.js" strategy="afterInteractive" />
    </>
  );
}
