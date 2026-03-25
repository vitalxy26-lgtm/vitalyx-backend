const mongoose = require('mongoose');

const DietLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, default: Date.now },
  items: [{
      n: String,   // food_name
      cal: Number, // calories
      p: Number,   // protein (g)
      c: Number,   // carbs (g)
      f: Number,   // fats (g)
      scanned: { type: Boolean, default: false },
      at: String   // loggedAt time e.g. "08:30"
  }],
  t_cal: { type: Number, default: 0 }, // total_calories
  t_p:   { type: Number, default: 0 }, // total_protein
  t_c:   { type: Number, default: 0 }, // total_carbs
  t_f:   { type: Number, default: 0 }, // total_fats
}, { timestamps: true });

// Auto-delete logs older than 90 days
DietLogSchema.index({ date: 1 }, { expireAfterSeconds: 7776000 });

module.exports = mongoose.model('DietLog', DietLogSchema);
