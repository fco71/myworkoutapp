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