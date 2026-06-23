import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Skill, Realm, BodyMetrics, FitnessGoalType, FitnessGoal, Habit, ActiveTimedQuest, AiAdaptationProfile, AiBehavioralPatterns, DailyMission, QuestStatus, Difficulty } from '../../types';
import { createInitialUser, createDefaultAdaptationProfile, createDefaultBehavioralPatterns, getXpThresholdForLevel, getRankForLevel, HIDDEN_SKILLS, getXpThresholdForSkillLevel } from '../../constants';
import { useUiStore } from './useUiStore';
import { useAuthStore } from './useAuthStore';
import { useQuestStore } from './useQuestStore';


interface UserStoreState {
    user: User;
    setUser: (updater: (prev: User) => User) => void;
    updateBodyMetrics: (metrics: Partial<BodyMetrics>) => void;
    setGoals: (primary: FitnessGoalType, secondary?: FitnessGoalType) => void;
    toggleLazyMode: () => void;
    toggleHomeMode: () => void;
    handleGrantReward: (baseXp: number, realm: Realm, activitySource: string, userUpdateFn?: (user: User) => Partial<User>) => void;
    handlePenalty: (xpDeduction: number, reason: string) => void;
    allocateStatPoint: (realm: Realm) => void;
    markOnboardingComplete: () => void;
    startTimedQuest: (title: string, realm: Realm, estimatedMinutes: number) => void;
    completeTimedQuest: () => void;
    addHabit: (habit: Habit) => void;
    deleteHabit: (id: string) => void;
    addSupplement: (supp: { name: string; dosage: string }) => void;
    deleteSupplement: (name: string) => void;
    updateSteps: (steps: number, distance: number) => void;
    checkDailyReset: () => Promise<void>;
    incrementStreak: () => void;
    incrementAiUsage: (type: 'mealScans' | 'formScans' | 'chatPrompts') => void;
    applyAiAdaptation: (updates: Partial<User>) => void;
    updateAiProfile: (profile: Partial<AiAdaptationProfile>) => void;
    updateBehavioralPatterns: (patterns: Partial<AiBehavioralPatterns>) => void;
}

export const useUserStore = create<UserStoreState>()(
    persist(
        (set, get) => ({
            user: createInitialUser(),
            setUser: (updater) => set((state) => ({ user: updater(state.user) })),
            updateBodyMetrics: (metrics) => set((state) => ({
                user: {
                    ...state.user,
                    bodyMetrics: { ...state.user.bodyMetrics, ...metrics }
                }
            })),
            setGoals: (primary, secondary) => set((state) => ({
                user: {
                    ...state.user,
                    primaryGoal: primary,
                    secondaryGoal: secondary
                }
            })),
            toggleLazyMode: () => set((state) => ({
                user: {
                    ...state.user,
                    isLazyMode: !state.user.isLazyMode
                }
            })),
            toggleHomeMode: () => set((state) => ({
                user: {
                    ...state.user,
                    isHomeMode: !state.user.isHomeMode
                }
            })),
            markOnboardingComplete: () => set((state) => ({
                user: {
                    ...state.user,
                    onboardingCompleted: true
                }
            })),
            handleGrantReward: (baseXp, realm, activitySource, userUpdateFn) => {
                set((state) => {
                    const prevUser = state.user;
                    let finalXp = baseXp;

                    // Apply streak bonus (Capped at +50%)
                    const dailyStreakBonus = Math.min(prevUser.streaks?.daily_streak || 0, 50);
                    finalXp = Math.floor(finalXp * (1 + dailyStreakBonus / 100));

                    // Apply Mode penalties
                    if (prevUser.isLazyMode || prevUser.isInjuryMode) {
                        finalXp = Math.floor(finalXp * 0.5);
                    }

                    // Apply Active Buffs (e.g. Double XP)
                    if (prevUser.activeBuffs && prevUser.activeBuffs.length > 0) {
                        const now = Date.now();
                        prevUser.activeBuffs.forEach(buff => {
                            if (buff.expiryTimestamp > now && buff.effect.type === 'xp_boost' && buff.effect.value) {
                                finalXp = Math.floor(finalXp * buff.effect.value);
                            }
                        });
                    }

                    let newXpTotal = prevUser.xp_total + finalXp;
                    let newLevel = prevUser.level_overall;
                    let newRank = prevUser.rank;
                    let xpForNext = prevUser.xpToNextLevel;

                    let newStatPoints = prevUser.stat_points;

                    while (newXpTotal >= xpForNext) {
                        newXpTotal -= xpForNext;
                        newLevel++;
                        newStatPoints += 5;
                        xpForNext = getXpThresholdForLevel(newLevel);
                        newRank = getRankForLevel(newLevel);
                    }

                    // Trigger LevelUp UI once with final level (avoids animation spam for multi-level jumps)
                    if (newLevel > prevUser.level_overall) {
                        useUiStore.getState().setLevelUp(newLevel, newRank);
                    }

                    const newStats = { ...prevUser.stats, [realm]: (prevUser.stats[realm] || 0) + 1 };
                    const newSkillTree = { ...prevUser.skill_tree };
                    const skillIdMap: { [key in Realm]?: string } = {
                        [Realm.Strength]: 'strength',
                        [Realm.Endurance]: 'endurance',
                        [Realm.Flexibility]: 'flexibility',
                        [Realm.Combat]: 'combat',
                        [Realm.Nutrition]: 'nutrition',
                        [Realm.Recovery]: 'recovery',
                    };

                    const skillId = skillIdMap[realm];
                    if (skillId && newSkillTree[skillId]) {
                        const skill = newSkillTree[skillId];
                        let skillXp = skill.xp + finalXp;
                        let skillLevel = skill.level;
                        let skillXpToNext = skill.xpToNextLevel;

                        while (skillXp >= skillXpToNext) {
                            skillXp -= skillXpToNext;
                            skillLevel++;
                            skillXpToNext = getXpThresholdForSkillLevel(skillLevel, skill.xpScale);
                        }

                        newSkillTree[skillId] = {
                            ...skill,
                            level: skillLevel,
                            xp: skillXp,
                            xpToNextLevel: skillXpToNext
                        };

                        // --- HIDDEN SKILL UNLOCK CHECK ---
                        Object.values(HIDDEN_SKILLS).forEach(hidden => {
                            if (!newSkillTree[hidden.id] && 
                                hidden.unlockRealm === realm && 
                                newSkillTree[skillId].level >= hidden.unlockLevel) {
                                
                                newSkillTree[hidden.id] = {
                                    id: hidden.id,
                                    name: hidden.name,
                                    realm: hidden.realm,
                                    priority: hidden.priority,
                                    isActive: true,
                                    xpScale: hidden.xpScale,
                                    level: 1,
                                    xp: 0,
                                    xpToNextLevel: getXpThresholdForSkillLevel(1, hidden.xpScale)
                                };
                                console.log(`[SYSTEM] New Skill Unlocked: ${hidden.name}`);
                            }
                        });
                    }

                    let updatedUser: User = {
                        ...prevUser,
                        level_overall: newLevel,
                        rank: newRank,
                        xp_total: newXpTotal,
                        xpToNextLevel: xpForNext,
                        stats: newStats,
                        skill_tree: newSkillTree,
                        stat_points: newStatPoints,
                    };

                    if (userUpdateFn) {
                        updatedUser = { ...updatedUser, ...userUpdateFn(updatedUser) };
                    }

                    return { user: updatedUser };
                });
            },
            handlePenalty: (xpDeduction, reason) => {
                set((state) => {
                    const prevUser = state.user;
                    let newXpTotal = Math.max(0, prevUser.xp_total - xpDeduction);
                    const today = new Date().toISOString().split('T')[0];
                    
                    return {
                        user: {
                            ...prevUser,
                            xp_total: newXpTotal,
                            lastPenaltyDate: today
                        }
                    };
                });
            },
            allocateStatPoint: (realm) => {
                set((state) => {
                    const prevUser = state.user;
                    if (prevUser.stat_points <= 0) return state;

                    return {
                        user: {
                            ...prevUser,
                            stat_points: prevUser.stat_points - 1,
                            stats: {
                                ...prevUser.stats,
                                [realm]: (prevUser.stats[realm] || 0) + 1
                            }
                        }
                    };
                });
            },
            startTimedQuest: (title, realm, estimatedMinutes) => set((state) => ({
                user: {
                    ...state.user,
                    activeTimedQuest: {
                        id: `timed-${Date.now()}`,
                        title,
                        realm,
                        estimatedMinutes,
                        startTime: new Date().toISOString(),
                    }
                }
            })),
            completeTimedQuest: () => {
                const state = get();
                if (!state.user.activeTimedQuest) return;
                
                const quest = state.user.activeTimedQuest;
                const xpReward = quest.estimatedMinutes * 5; // 5 XP per minute
                
                state.handleGrantReward(xpReward, quest.realm, `Timed Session: ${quest.title}`);
                
                set((state) => ({
                    user: {
                        ...state.user,
                        activeTimedQuest: null
                    }
                }));
            },
            addHabit: (habit) => set((state) => ({
                user: {
                    ...state.user,
                    habits: [...(state.user.habits || []), habit]
                }
            })),
            deleteHabit: (id) => set((state) => ({
                user: {
                    ...state.user,
                    habits: (state.user.habits || []).filter(h => h.id !== id)
                }
            })),
            addSupplement: (supp) => set((state) => ({
                user: {
                    ...state.user,
                    supplementProtocol: [...(state.user.supplementProtocol || []), supp]
                }
            })),
            deleteSupplement: (name: string) => set((state) => ({
                user: {
                    ...state.user,
                    supplementProtocol: (state.user.supplementProtocol || []).filter(s => s.name !== name)
                }
            })),
            updateSteps: (steps, distance) => set((state) => ({
                user: {
                    ...state.user,
                    currentSteps: steps,
                    currentDistance: distance,
                    lastStepSync: new Date().toISOString(),
                }
            })),
            checkDailyReset: async () => {
                const now = new Date();
                const today = now.toISOString().split('T')[0];
                const lastReset = get().user.lastStepSync?.split('T')[0];

                if (lastReset !== today) {
                    const prevUser = get().user;

                    // 1. Reset AI Usage if new day
                    const aiUsage = prevUser.aiUsage || { mealScans: 0, formScans: 0, chatPrompts: 0, lastUsageReset: '', scannedImageHashes: [] };
                    const shouldResetUsage = aiUsage.lastUsageReset !== today;
                    
                    // 2. Check if Genesis already ran today
                    const shouldRunGenesis = prevUser.lastGenesisDate !== today && prevUser.onboardingCompleted;

                    let updatedUser = { ...prevUser };

                    if (shouldResetUsage) {
                        updatedUser.aiUsage = {
                            mealScans: 0,
                            formScans: 0,
                            chatPrompts: 0,
                            lastUsageReset: today,
                            scannedImageHashes: []
                        };
                    }

                    if (shouldRunGenesis) {
                        try {
                            const { generateUserStateSnapshot } = await import('../services/snapshotService');
                            const { generateDailyGenesis } = await import('../../services/geminiService');
                            const { apiKey } = useAuthStore.getState();

                            const snapshot = await generateUserStateSnapshot(get().user);
                            const blueprint = await generateDailyGenesis(apiKey, snapshot);
                            
                            if (blueprint && blueprint.daily_blueprint) {
                                const mission: DailyMission = {
                                    id: `mission-${today}`,
                                    title: `PROTOCOL: ${blueprint.primary_goal.toUpperCase()}`,
                                    date: today,
                                    warmUp: { title: "Warm-up", exercises: blueprint.daily_blueprint.workout_plan.exercises.slice(0, 2) },
                                    coreWorkout: { title: "Core Protocol", exercises: blueprint.daily_blueprint.workout_plan.exercises },
                                    cooldown: { title: "Cooldown", exercises: [] },
                                    recovery: [blueprint.daily_blueprint.recovery_protocol?.active_recovery ?? ''].filter(Boolean),
                                    status: QuestStatus.Pending,
                                    nutritionPlan: {
                                        targetCalories: blueprint.daily_blueprint.calories_target_kcal ?? 2000,
                                        proteinGrams: blueprint.daily_blueprint.protein_target_g ?? 150,
                                        carbsGrams: blueprint.daily_blueprint.carbs_target_g ?? 250,
                                        fatsGrams: blueprint.daily_blueprint.fats_target_g ?? 65,
                                        hydrationTargetMl: blueprint.daily_blueprint.hydration_target_ml ?? 2500,
                                    },
                                    xp_reward: 500,
                                    difficulty: Difficulty.Medium,
                                };
                                useQuestStore.getState().setDailyMission(mission);
                                updatedUser.lastGenesisDate = today;
                                console.log(`[SYSTEM] Daily Blueprint Applied for ${today}`);
                            }
                        } catch (err) {
                            console.error('[VoidFit] Genesis Error:', err);
                        }
                    }

                    set({ user: updatedUser });

                    set((state) => ({
                        user: {
                            ...state.user,
                            currentSteps: 0,
                            currentDistance: 0,
                            lastStepSync: now.toISOString(),
                        }
                    }));
                    console.log(`[SYSTEM] Daily Reset Initialized for ${today}`);
                }
            },
            incrementStreak: () => set((state) => ({
                user: {
                    ...state.user,
                    streaks: {
                        ...state.user.streaks,
                        daily_streak: state.user.streaks.daily_streak + 1,
                        lastQuestCompletionDate: new Date().toISOString().split('T')[0],
                    }
                }
            })),
            incrementAiUsage: (type) => set((state) => {
                const today = new Date().toISOString().split('T')[0];
                const prevUsage = state.user.aiUsage || { mealScans: 0, formScans: 0, chatPrompts: 0, lastUsageReset: '', scannedImageHashes: [] };
                
                const isNewDay = prevUsage.lastUsageReset !== today;
                
                return {
                    user: {
                        ...state.user,
                        aiUsage: {
                            ...prevUsage,
                            [type]: (isNewDay ? 0 : prevUsage[type] || 0) + 1,
                            lastUsageReset: today
                        }
                    }
                };
            }),
            applyAiAdaptation: (updates) => set((state) => ({
                user: { ...state.user, ...updates },
            })),
            updateAiProfile: (profile) => set((state) => {
                // FIX: Ensure userState exists before accessing it
                const userState = state.user.userState || { aiAdaptationProfile: createDefaultAdaptationProfile(), behavioralPatterns: createDefaultBehavioralPatterns() };
                const existing = userState.aiAdaptationProfile || createDefaultAdaptationProfile();
                return {
                    user: {
                        ...state.user,
                        userState: {
                            ...userState,
                            aiAdaptationProfile: { ...existing, ...profile, lastAdaptation: new Date().toISOString() },
                        },
                    },
                };
            }),
            updateBehavioralPatterns: (patterns) => set((state) => {
                // FIX: Ensure userState exists before accessing it
                const userState = state.user.userState || { aiAdaptationProfile: createDefaultAdaptationProfile(), behavioralPatterns: createDefaultBehavioralPatterns() };
                const existing = userState.behavioralPatterns || createDefaultBehavioralPatterns();
                return {
                    user: {
                        ...state.user,
                        userState: {
                            ...userState,
                            behavioralPatterns: { ...existing, ...patterns, lastAnalysis: new Date().toISOString() },
                        },
                    },
                };
            }),
        }),
        {
            name: 'user-storage',
        }
    )
);

