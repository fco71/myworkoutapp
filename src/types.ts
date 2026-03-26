export type WorkoutType = string; // flexible, user-defined types like 'Bike', 'Calves', 'Resistance', 'Cardio'

export interface Exercise {
  id: string;
  name: string;
  type: WorkoutType;
}

export interface SetEntry {
  weight?: number;
  reps?: number;
  rpe?: number;
}

export interface ExerciseSet {
  id: string;
  exerciseId: string;
  name: string;
  ts: number;
  sets: SetEntry[];
}

export interface ActivityLog {
  id: string;
  type: WorkoutType;
  name: string;
  durationMin?: number;
  ts: number;
}

export interface Routine {
  id: string;
  name: string;
  items: Array<{ exerciseId: string; name: string; targetSets: number; restSec: number }>;
}

export type WeeklyGoals = Record<WorkoutType, number>;

// --- App-specific types ---

export type ResistanceExercise = {
  id: string;
  name: string;
  minSets: number;
  targetReps: number;
  intensity: number;
  sets: number[];
  notes: string;
};

export type ResistanceSession = {
  id?: string;
  dateISO: string;
  sessionName: string;
  exercises: ResistanceExercise[];
  completed: boolean;
  sessionTypes: string[];
  durationSec: number;
  startedAt?: number;
  completedAt?: number;
  ts?: number;
  sourceTemplateId?: string;
};

export type WeeklyDay = {
  dateISO: string;
  types: Record<string, boolean>;
  sessions: number;
  sessionsList: any[];
  comments: Record<string, string>;
};

export type WeeklyPlan = {
  weekOfISO: string;
  weekNumber: number;
  days: WeeklyDay[];
  benchmarks: Record<string, number>;
  customTypes: string[];
  typeCategories: Record<string, string>;
};

export type PersistedState = { weekly: WeeklyPlan; session: ResistanceSession };
