const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  
  // Auth Extras
  is_email_verified: { type: Boolean, default: false },
  verification_token: { type: String },
  verification_token_expires: { type: Date },
  
  // Profile settings
  age: Number,
  gender: String,
  height: Number,
  weight: Number,
  fitness_level: { type: String, enum: ['beginner', 'intermediate', 'advanced'] },
  goal: { type: String, enum: ['fat_loss', 'muscle_gain', 'maintain_weight'] },
  diet_preference: { type: String, enum: ['vegetarian', 'non_vegetarian', 'vegan'] },
  target_weight: Number,
  target_timeframe_weeks: Number,
  
  // Monetization
  is_premium:              { type: Boolean, default: false },
  subscription_plan:       { type: String, enum: ['free', 'monthly', 'annual'], default: 'free' },
  subscription_expires_at: { type: Date, default: null },

  // Workout preference
  equipment: { type: String, enum: ['home_no_equipment', 'home_with_equipment', 'gym'], default: 'home_no_equipment' },

  // Weight check-in tracking
  weight_updated_at: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
