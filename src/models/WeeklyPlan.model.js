const mongoose = require('mongoose');

const ExerciseSchema = new mongoose.Schema({
  name:  String,
  sets:  Number,
  reps:  String,
  dur_s: Number,  // duration_seconds per set
  rest_s: Number, // rest_seconds after exercise
  tip:   String,  // short instruction
}, { _id: false });

const DaySchema = new mongoose.Schema({
  day:          String, // "Monday"
  muscle_group: String, // "Chest"
  focus:        String, // "Push Strength"
  exercises:    [ExerciseSchema],
}, { _id: false });

const WeeklyPlanSchema = new mongoose.Schema({
  user_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  generated_at: { type: Date, default: Date.now },
  duration_minutes: { type: Number, default: 60 },
  custom_request: { type: String, default: '' },
  days:         [DaySchema],
}, { timestamps: true });

module.exports = mongoose.model('WeeklyPlan', WeeklyPlanSchema);
