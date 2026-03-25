const mongoose = require('mongoose');

const WorkoutLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:     { type: Date, default: Date.now },
  focus:    String,   // e.g. "Chest", "Full Body"
  dur_min:  Number,   // duration_minutes
  exercises: [String], // just names: ["Pushups", "Squats"]
  at:        String,  // start time e.g. "18:30"
}, { timestamps: true });

// Auto-delete logs older than 90 days
WorkoutLogSchema.index({ date: 1 }, { expireAfterSeconds: 7776000 });

module.exports = mongoose.model('WorkoutLog', WorkoutLogSchema);
