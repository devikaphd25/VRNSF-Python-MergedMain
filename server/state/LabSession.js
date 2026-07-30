export class LabSession {
  constructor(studentId, studentName, seat) {
    this.studentId = studentId;
    this.studentName = studentName;
    this.seat = seat;
    this.socketId = null;
    this.score = 0;
    this.streak = 0;
    this.wpm = 0;
    this.accuracy = 0;
    this.completedExercises = [];
    this.currentExercise = 0;
    this.totalCards = 12;
    this.correctAnswers = 0;
    this.wrongAnswers = 0;
    this.durationSeconds = 0;
    this.status = "working";
    this.returnReason = null;
    this.resultSaved = false;
    this.mistakes = [];
    this.gameState = {
      lessonState: "idle",
    };
    this.joinedAt = new Date();
  }

  completeExercise(exerciseId, data = {}) {
    const normalizedExerciseId = Number(exerciseId);

    if (
      Number.isInteger(normalizedExerciseId) &&
      normalizedExerciseId > 0 &&
      !this.completedExercises.includes(normalizedExerciseId)
    ) {
      this.completedExercises.push(normalizedExerciseId);
    }

    if (
      Number.isInteger(normalizedExerciseId) &&
      normalizedExerciseId > 0
    ) {
      this.currentExercise = Math.max(
        this.currentExercise,
        normalizedExerciseId
      );
    }

    this.score += Number(data.score) || 1;
    this.streak = Number(data.streak) || 0;
    this.wpm = Number(data.wpm) || 0;
    this.accuracy = Number(data.accuracy) || 0;
  }

  getNextExercise() {
    const nextId = this.currentExercise + 1;

    const exercises = [
      {
        id: 1,
        code: "print('Hello, World!')",
        title: "Basic Print",
        difficulty: "beginner",
      },
      {
        id: 2,
        code: "name = 'Python'",
        title: "Variables",
        difficulty: "beginner",
      },
      {
        id: 3,
        code: "age = 25",
        title: "Numbers",
        difficulty: "beginner",
      },
      {
        id: 4,
        code: "print(f'My name is {name}')",
        title: "f-strings",
        difficulty: "beginner",
      },
      {
        id: 5,
        code: "def greet(name): return f'Hello, {name}'",
        title: "Functions",
        difficulty: "intermediate",
      },
      {
        id: 6,
        code: "for i in range(5): print(i)",
        title: "Loops",
        difficulty: "intermediate",
      },
      {
        id: 7,
        code: "if x > 0: print('Positive')",
        title: "Conditionals",
        difficulty: "intermediate",
      },
      {
        id: 8,
        code:
          "class Student: def __init__(self, name): self.name = name",
        title: "Classes",
        difficulty: "advanced",
      },
      {
        id: 9,
        code: "import math; print(math.sqrt(16))",
        title: "Imports",
        difficulty: "advanced",
      },
      {
        id: 10,
        code: "lambda x: x * 2",
        title: "Lambda",
        difficulty: "advanced",
      },
    ];

    const exercise =
      exercises.find(item => item.id === nextId) ??
      exercises[0];

    return {
      exerciseId: exercise.id,
      exerciseData: {
        title: exercise.title,
        code: exercise.code,
        difficulty: exercise.difficulty,
        description:
          `Type the following ${exercise.difficulty} code correctly.`,
      },
    };
  }

  getProgress() {
    return {
      completed: this.completedExercises.length,
      total: this.totalCards,
      score: this.score,
      streak: this.streak,
      accuracy: this.accuracy,
      wpm: this.wpm,
      correctAnswers: this.correctAnswers,
      wrongAnswers: this.wrongAnswers,
      durationSeconds: this.durationSeconds,
      status: this.status,
      returnReason: this.returnReason,
    };
  }
}
