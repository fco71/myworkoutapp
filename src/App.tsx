import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './components/ui/card';
import { Button } from './components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

type Exercise = {
  id: string;
  name: string;
  targetReps: number;
  sets: number[];
  minSets: number;
};

function App() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseReps, setNewExerciseReps] = useState(6);
  const [currentDate] = useState(new Date().toISOString().split('T')[0]);

  const addExercise = () => {
    if (!newExerciseName.trim()) return;
    
    const newExercise: Exercise = {
      id: Date.now().toString(),
      name: newExerciseName.trim(),
      targetReps: newExerciseReps,
      sets: [],
      minSets: 3,
    };
    
    setExercises((prev) => [...prev, newExercise]);
    setNewExerciseName('');
  };

  const addSet = (exerciseId: string) => {
    setExercises((prev) => prev.map(ex => 
      ex.id === exerciseId 
        ? { ...ex, sets: [...ex.sets, 0] } 
        : ex
    ));
  };

  const updateReps = (exerciseId: string, setIndex: number, value: number) => {
    setExercises((prev) => prev.map(ex => 
      ex.id === exerciseId 
        ? { 
            ...ex, 
            sets: ex.sets.map((rep, idx) => idx === setIndex ? Math.max(0, value) : rep) 
          } 
        : ex
    ));
  };

  const deleteExercise = (exerciseId: string) => {
    setExercises((prev) => prev.filter(ex => ex.id !== exerciseId));
  };

  const getCellClass = (exercise: Exercise, reps: number, index: number) => {
    if (reps >= exercise.targetReps) return 'bg-green-200';
    if (index < exercise.minSets) return 'bg-red-200';
    return 'bg-yellow-100';
  };

  const getExerciseClass = (exercise: Exercise) => {
    const totalReps = exercise.sets.reduce((sum, reps) => sum + reps, 0);
    const targetTotalReps = exercise.targetReps * exercise.minSets;
    
    if (totalReps >= targetTotalReps) return 'border-l-4 border-green-500';
    if (exercise.sets.length >= exercise.minSets) return 'border-l-4 border-yellow-500';
    return 'border-l-4 border-red-500';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-2">Workout Tracker</h1>
        <p className="text-center text-gray-600 mb-8">{currentDate}</p>
        
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Add New Exercise</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                value={newExerciseName}
                onChange={(e) => setNewExerciseName(e.target.value)}
                placeholder="Exercise name"
                className="flex-1 p-2 border rounded"
                onKeyDown={(e) => e.key === 'Enter' && addExercise()}
              />
              <div className="flex items-center gap-2">
                <span>Target Reps:</span>
                <input
                  type="number"
                  min="1"
                  value={newExerciseReps}
                  onChange={(e) => setNewExerciseReps(parseInt(e.target.value) || 1)}
                  className="w-16 p-2 border rounded"
                />
              </div>
              <Button onClick={addExercise} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="mr-2 h-4 w-4" /> Add Exercise
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {exercises.map((exercise) => (
            <Card key={exercise.id} className={getExerciseClass(exercise)}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-xl">{exercise.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">
                      Total: {exercise.sets.reduce((sum, reps) => sum + reps, 0)} / 
                      {exercise.targetReps * exercise.minSets} reps
                    </span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => deleteExercise(exercise.id)}
                      className="text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="flex flex-wrap gap-2 mb-3">
                  {exercise.sets.map((reps, index) => (
                    <div key={index} className="relative">
                      <input
                        type="number"
                        min="0"
                        value={reps}
                        onChange={(e) => updateReps(exercise.id, index, parseInt(e.target.value) || 0)}
                        className={`w-16 p-2 border rounded text-center ${getCellClass(exercise, reps, index)}`}
                      />
                      <span className="absolute -top-2 -right-2 text-xs bg-gray-200 rounded-full w-5 h-5 flex items-center justify-center">
                        {index + 1}
                      </span>
                    </div>
                  ))}
                  <button
                    onClick={() => addSet(exercise.id)}
                    className="w-16 h-10 flex items-center justify-center border-2 border-dashed rounded text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
                <div className="text-sm text-gray-600">
                  <p>Target: {exercise.minSets} sets of {exercise.targetReps} reps</p>
                  <p>Completed: {exercise.sets.filter(reps => reps > 0).length} sets</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
