import NotificationPreference from "../models/NotificationPreference.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { getNotificationPeriod } from "../utils/notificationPeriod.js";
import { sendEmail } from "./emailService.js";

export const processNotifications = async () => {
  const preferences = await NotificationPreference.find({
    enabled: true,
  }).populate("trainer", "name email accountStatus");
  console.log("Enabled preferences:", preferences.length);
  const today = new Date();

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "Africa/Casablanca",
  }).format(today);

  const isMonday = weekday === "Monday";
  let processed = 0;

  for (const preference of preferences) {
    const trainer = preference.trainer;
    console.log("Trainer:", preference.trainer?.email);
    console.log("Account status:", preference.trainer?.accountStatus);
    console.log("Frequency:", preference.frequency);
    // Skip deleted or suspended trainers
    if (!trainer || trainer.accountStatus !== "active") {
      continue;
    }
    if (preference.frequency === "weekly" && !isMonday) {
      continue;
    }

    const period = getNotificationPeriod(preference.frequency, today);

    try {
      // Claim this trainer's notification period
      await NotificationDelivery.create({
        trainer: trainer._id,
        frequency: preference.frequency,
        period: period,
        status: "pending",
      });
    } catch (error) {
      if (error.code === 11000) {
        console.log(`Already claimed: ${trainer.email} (${period})`);
        continue;
      }

      throw error;
    }

    console.log(`Processing notifications for ${trainer.email}`);

    try {
      await sendEmail(
        trainer.email,
        "LMS - Notification",
        "<p>Bonjour, vous avez une nouvelle notification LMS.</p>",
      );

      await NotificationDelivery.updateOne(
        {
          trainer: trainer._id,
          frequency: preference.frequency,
          period: period,
        },
        {
          $set: { status: "sent" },
        },
      );

      console.log("Notification sent to:", trainer.email);
    } catch (error) {
      await NotificationDelivery.updateOne(
        {
          trainer: trainer._id,
          frequency: preference.frequency,
          period: period,
        },
        {
          $set: { status: "failed" },
        },
      );

      console.error("Notification failed:", error.message);
    }

    console.log("Frequency:", preference.frequency);
    console.log("Courses:", preference.courses);

    processed++;
  }

  return {
    processed: processed,
  };
};
