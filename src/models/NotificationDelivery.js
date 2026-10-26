import mongoose from "mongoose";

const notificationDeliverySchema = new mongoose.Schema(
  {
    trainer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    frequency: {
      type: String,
      enum: ["daily", "weekly"],
      required: true,
    },

    period: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastAttemptAt: {
      type: Date,
      default: null,
    },

    lastError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

// One delivery record per trainer, frequency and period
notificationDeliverySchema.index(
  { trainer: 1, frequency: 1, period: 1 },
  { unique: true },
);

const NotificationDelivery = mongoose.model(
  "NotificationDelivery",
  notificationDeliverySchema,
);

export default NotificationDelivery;
