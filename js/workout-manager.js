class WorkoutManager {
    constructor(db) {
        this.db = db;
        this.exercises = [];
        this.workouts = [];
        this.currentWorkout = null;
        this.currentWorkoutExercises = [];
        this.initializeEventListeners();
        this.loadExercises();
        this.loadWorkouts();
    }

    async initializeEventListeners() {
        // Exercise management
        document.getElementById('addExerciseBtn').addEventListener('click', () => this.showExerciseModal());
        document.getElementById('saveExerciseBtn').addEventListener('click', () => this.saveExercise());
        
        // Workout management
        document.getElementById('createWorkoutBtn').addEventListener('click', () => this.showWorkoutModal());
        document.getElementById('saveWorkoutBtn').addEventListener('click', () => this.saveWorkout());
        
        // Workout execution
        document.getElementById('startWorkoutBtn').addEventListener('click', () => this.startWorkout());
        document.getElementById('finishWorkoutBtn').addEventListener('click', () => this.finishWorkout());
    }

    // Exercise CRUD operations
    async loadExercises() {
        try {
            const snapshot = await this.db.collection('exercises').get();
            this.exercises = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            this.renderExerciseList();
        } catch (error) {
            console.error('Error loading exercises:', error);
        }
    }

    showExerciseModal(exercise = null) {
        const modal = document.getElementById('exerciseModal');
        const form = document.getElementById('exerciseForm');
        
        if (exercise) {
            // Edit mode
            form.elements['exerciseId'].value = exercise.id;
            form.elements['exerciseName'].value = exercise.name;
            form.elements['exerciseType'].value = exercise.type || 'strength';
            form.elements['exerciseMuscleGroup'].value = exercise.muscleGroup || '';
            form.elements['exerciseDescription'].value = exercise.description || '';
            document.getElementById('exerciseModalTitle').textContent = 'Edit Exercise';
        } else {
            // New exercise
            form.reset();
            form.elements['exerciseId'].value = '';
            document.getElementById('exerciseModalTitle').textContent = 'Add New Exercise';
        }
        
        modal.classList.remove('hidden');
    }

    async saveExercise() {
        const form = document.getElementById('exerciseForm');
        const exerciseData = {
            name: form.elements['exerciseName'].value.trim(),
            type: form.elements['exerciseType'].value,
            muscleGroup: form.elements['exerciseMuscleGroup'].value,
            description: form.elements['exerciseDescription'].value,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: firebase.auth().currentUser.uid
        };

        try {
            const exerciseId = form.elements['exerciseId'].value;
            if (exerciseId) {
                // Update existing exercise
                await this.db.collection('exercises').doc(exerciseId).update(exerciseData);
            } else {
                // Add new exercise
                await this.db.collection('exercises').add(exerciseData);
            }
            this.closeModal('exerciseModal');
            this.loadExercises();
        } catch (error) {
            console.error('Error saving exercise:', error);
            alert('Failed to save exercise. Please try again.');
        }
    }

    // Workout CRUD operations
    async loadWorkouts() {
        try {
            const snapshot = await this.db
                .collection('workouts')
                .where('createdBy', '==', firebase.auth().currentUser.uid)
                .get();
                
            this.workouts = await Promise.all(snapshot.docs.map(async doc => {
                const workout = { id: doc.id, ...doc.data() };
                // Load exercises for each workout
                const exercisesSnapshot = await doc.ref.collection('exercises').get();
                workout.exercises = exercisesSnapshot.docs.map(exDoc => ({
                    id: exDoc.id,
                    ...exDoc.data()
                }));
                return workout;
            }));
            
            this.renderWorkoutList();
        } catch (error) {
            console.error('Error loading workouts:', error);
        }
    }

    showWorkoutModal(workout = null) {
        const modal = document.getElementById('workoutModal');
        const form = document.getElementById('workoutForm');
        
        if (workout) {
            // Edit mode
            form.elements['workoutId'].value = workout.id;
            form.elements['workoutName'].value = workout.name;
            form.elements['workoutDescription'].value = workout.description || '';
            document.getElementById('workoutModalTitle').textContent = 'Edit Workout';
            
            // Pre-select exercises
            const exerciseSelect = document.getElementById('workoutExercises');
            exerciseSelect.innerHTML = '';
            this.exercises.forEach(exercise => {
                const option = document.createElement('option');
                option.value = exercise.id;
                option.textContent = exercise.name;
                option.selected = workout.exercises.some(ex => ex.id === exercise.id);
                exerciseSelect.appendChild(option);
            });
        } else {
            // New workout
            form.reset();
            form.elements['workoutId'].value = '';
            document.getElementById('workoutModalTitle').textContent = 'Create New Workout';
            
            // Populate exercise select
            const exerciseSelect = document.getElementById('workoutExercises');
            exerciseSelect.innerHTML = '';
            this.exercises.forEach(exercise => {
                const option = document.createElement('option');
                option.value = exercise.id;
                option.textContent = exercise.name;
                exerciseSelect.appendChild(option);
            });
        }
        
        modal.classList.remove('hidden');
    }

    async saveWorkout() {
        const form = document.getElementById('workoutForm');
        const workoutData = {
            name: form.elements['workoutName'].value.trim(),
            description: form.elements['workoutDescription'].value,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: firebase.auth().currentUser.uid
        };

        const selectedExerciseIds = Array.from(form.elements['workoutExercises'].selectedOptions)
            .map(option => option.value);

        try {
            const workoutId = form.elements['workoutId'].value;
            let workoutRef;
            
            if (workoutId) {
                // Update existing workout
                await this.db.collection('workouts').doc(workoutId).update({
                    ...workoutData,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                workoutRef = this.db.collection('workouts').doc(workoutId);
                
                // Delete existing exercises
                const batch = this.db.batch();
                const exercisesSnapshot = await workoutRef.collection('exercises').get();
                exercisesSnapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
            } else {
                // Add new workout
                workoutRef = await this.db.collection('workouts').add(workoutData);
            }
            
            // Add selected exercises
            const batch = this.db.batch();
            for (const exerciseId of selectedExerciseIds) {
                const exercise = this.exercises.find(ex => ex.id === exerciseId);
                if (exercise) {
                    const exerciseRef = workoutRef.collection('exercises').doc();
                    batch.set(exerciseRef, {
                        exerciseId: exercise.id,
                        name: exercise.name,
                        type: exercise.type,
                        muscleGroup: exercise.muscleGroup,
                        order: selectedExerciseIds.indexOf(exerciseId),
                        sets: 3, // Default sets
                        reps: 10, // Default reps
                        weight: 0, // Default weight
                        restTime: 60 // Default rest time in seconds
                    });
                }
            }
            await batch.commit();
            
            this.closeModal('workoutModal');
            this.loadWorkouts();
        } catch (error) {
            console.error('Error saving workout:', error);
            alert('Failed to save workout. Please try again.');
        }
    }

    // Workout execution
    async startWorkout(workoutId) {
        const workout = this.workouts.find(w => w.id === workoutId);
        if (!workout) return;
        
        this.currentWorkout = {
            id: workout.id,
            name: workout.name,
            startTime: new Date(),
            exercises: workout.exercises.map(ex => ({
                ...ex,
                completed: false,
                sets: ex.sets || 3,
                reps: ex.reps || 10,
                weight: ex.weight || 0,
                restTime: ex.restTime || 60,
                notes: ''
            }))
        };
        
        this.renderCurrentWorkout();
        document.getElementById('workoutListContainer').classList.add('hidden');
        document.getElementById('currentWorkoutContainer').classList.remove('hidden');
    }

    renderCurrentWorkout() {
        const container = document.getElementById('currentWorkoutExercises');
        container.innerHTML = '';
        
        this.currentWorkout.exercises.forEach((exercise, index) => {
            const exerciseEl = document.createElement('div');
            exerciseEl.className = 'exercise-card';
            exerciseEl.innerHTML = `
                <h3>${exercise.name}</h3>
                <div class="exercise-sets">
                    ${Array(exercise.sets).fill().map((_, setIndex) => `
                        <div class="set-row">
                            <span>Set ${setIndex + 1}:</span>
                            <input type="number" min="0" value="${exercise.reps}" data-exercise-index="${index}" data-set-index="${setIndex}" data-field="reps">
                            <span>x</span>
                            <input type="number" min="0" step="0.5" value="${exercise.weight}" data-exercise-index="${index}" data-set-index="${setIndex}" data-field="weight">
                            <span>kg</span>
                            <input type="checkbox" data-exercise-index="${index}" data-set-index="${setIndex}" class="set-completed">
                        </div>
                    `).join('')}
                </div>
                <div class="exercise-notes">
                    <textarea placeholder="Notes..." data-exercise-index="${index}" data-field="notes">${exercise.notes || ''}</textarea>
                </div>
            `;
            container.appendChild(exerciseEl);
        });
        
        // Add event listeners for inputs
        container.querySelectorAll('input, textarea').forEach(input => {
            input.addEventListener('change', (e) => this.updateCurrentWorkout(e));
        });
    }

    updateCurrentWorkout(event) {
        const { target } = event;
        const exerciseIndex = parseInt(target.dataset.exerciseIndex);
        const setIndex = parseInt(target.dataset.setIndex);
        const field = target.dataset.field;
        
        if (field === 'reps' || field === 'weight') {
            // Update set data
            const value = field === 'weight' ? parseFloat(target.value) : parseInt(target.value);
            if (!isNaN(value)) {
                if (!this.currentWorkout.exercises[exerciseIndex].setsData) {
                    this.currentWorkout.exercises[exerciseIndex].setsData = [];
                }
                if (!this.currentWorkout.exercises[exerciseIndex].setsData[setIndex]) {
                    this.currentWorkout.exercises[exerciseIndex].setsData[setIndex] = {};
                }
                this.currentWorkout.exercises[exerciseIndex].setsData[setIndex][field] = value;
            }
        } else if (field === 'notes') {
            // Update exercise notes
            this.currentWorkout.exercises[exerciseIndex].notes = target.value;
        } else if (target.classList.contains('set-completed')) {
            // Toggle set completion
            if (!this.currentWorkout.exercises[exerciseIndex].setsCompleted) {
                this.currentWorkout.exercises[exerciseIndex].setsCompleted = [];
            }
            if (target.checked) {
                this.currentWorkout.exercises[exerciseIndex].setsCompleted.push(setIndex);
            } else {
                this.currentWorkout.exercises[exerciseIndex].setsCompleted = 
                    this.currentWorkout.exercises[exerciseIndex].setsCompleted.filter(i => i !== setIndex);
            }
        }
    }

    async finishWorkout() {
        if (!this.currentWorkout) return;
        
        try {
            const workoutLog = {
                workoutId: this.currentWorkout.id,
                workoutName: this.currentWorkout.name,
                startTime: this.currentWorkout.startTime,
                endTime: new Date(),
                duration: Math.floor((new Date() - this.currentWorkout.startTime) / 1000), // in seconds
                exercises: this.currentWorkout.exercises.map(exercise => ({
                    exerciseId: exercise.exerciseId,
                    name: exercise.name,
                    type: exercise.type,
                    muscleGroup: exercise.muscleGroup,
                    sets: exercise.sets,
                    reps: exercise.reps,
                    weight: exercise.weight,
                    restTime: exercise.restTime,
                    notes: exercise.notes,
                    setsData: exercise.setsData || []
                })),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: firebase.auth().currentUser.uid
            };
            
            await this.db.collection('workoutLogs').add(workoutLog);
            
            // Reset current workout
            this.currentWorkout = null;
            document.getElementById('currentWorkoutContainer').classList.add('hidden');
            document.getElementById('workoutListContainer').classList.remove('hidden');
            
            // Show success message
            alert('Workout saved successfully!');
        } catch (error) {
            console.error('Error saving workout log:', error);
            alert('Failed to save workout. Please try again.');
        }
    }

    // UI Rendering
    renderExerciseList() {
        const container = document.getElementById('exerciseList');
        if (!container) return;
        
        container.innerHTML = this.exercises
            .map(exercise => `
                <div class="exercise-item">
                    <div class="exercise-info">
                        <h4>${exercise.name}</h4>
                        <span class="exercise-type">${exercise.type} • ${exercise.muscleGroup}</span>
                        ${exercise.description ? `<p>${exercise.description}</p>` : ''}
                    </div>
                    <div class="exercise-actions">
                        <button class="btn-edit" data-id="${exercise.id}">Edit</button>
                    </div>
                </div>
            `)
            .join('');
        
        // Add event listeners for edit buttons
        container.querySelectorAll('.btn-edit').forEach(button => {
            button.addEventListener('click', (e) => {
                const exerciseId = e.target.dataset.id;
                const exercise = this.exercises.find(ex => ex.id === exerciseId);
                if (exercise) {
                    this.showExerciseModal(exercise);
                }
            });
        });
    }

    renderWorkoutList() {
        const container = document.getElementById('workoutList');
        if (!container) return;
        
        container.innerHTML = this.workouts
            .map(workout => `
                <div class="workout-item">
                    <div class="workout-info">
                        <h4>${workout.name}</h4>
                        ${workout.description ? `<p>${workout.description}</p>` : ''}
                        <div class="workout-exercises">
                            ${workout.exercises.slice(0, 3).map(ex => ex.name).join(' • ')}
                            ${workout.exercises.length > 3 ? `• +${workout.exercises.length - 3} more` : ''}
                        </div>
                    </div>
                    <div class="workout-actions">
                        <button class="btn-start" data-id="${workout.id}">Start</button>
                        <button class="btn-edit" data-id="${workout.id}">Edit</button>
                    </div>
                </div>
            `)
            .join('');
        
        // Add event listeners for action buttons
        container.querySelectorAll('.btn-start').forEach(button => {
            button.addEventListener('click', (e) => {
                const workoutId = e.target.dataset.id;
                this.startWorkout(workoutId);
            });
        });
        
        container.querySelectorAll('.btn-edit').forEach(button => {
            button.addEventListener('click', (e) => {
                const workoutId = e.target.dataset.id;
                const workout = this.workouts.find(w => w.id === workoutId);
                if (workout) {
                    this.showWorkoutModal(workout);
                }
            });
        });
    }

    // Utility methods
    closeModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }
}

// Initialize WorkoutManager when the page loads
let workoutManager;
document.addEventListener('DOMContentLoaded', () => {
    if (firebase.auth().currentUser) {
        workoutManager = new WorkoutManager(firebase.firestore());
    } else {
        // Listen for auth state changes
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                workoutManager = new WorkoutManager(firebase.firestore());
            }
        });
    }
});
