import NotificationPreference from "../models/NotificationPreference.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { getNotificationPeriod } from "../utils/notificationPeriod.js";
import { sendEmail } from "./emailService.js";

import Enrollment from "../models/Enrollment.js";
import Progress from "../models/progress.js";
import { inactiveLearnerReminderEmail } from "./emailTemplates.js";

const MAX_ATTEMPTS = 3;

export const processNotifications = async () => {
  const preferences = await NotificationPreference.find({
    enabled: true,
  }).populate("trainer", "name email accountStatus");

  const today = new Date();

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "Africa/Casablanca",
  }).format(today);

  const isMonday = weekday === "Monday";

  let processed = 0;

  for (const preference of preferences) {
    const trainer = preference.trainer;

    if (!trainer || trainer.accountStatus !== "active") {
      continue;
    }

    if (preference.frequency === "weekly" && !isMonday) {
      continue;
    }

    const period = getNotificationPeriod(preference.frequency, today);

    const deliveryKey = {
      trainer: trainer._id,
      frequency: preference.frequency,
      period: period,
    };

    const attemptTime = new Date();

    try {
      // First attempt: claim the notification period
      await NotificationDelivery.create({
        ...deliveryKey,
        status: "pending",
        attempts: 1,
        lastAttemptAt: attemptTime,
        lastError: null,
      });
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      // Retry only previously failed notifications
      const retry = await NotificationDelivery.findOneAndUpdate(
        {
          ...deliveryKey,
          status: "failed",
          $or: [
            { attempts: { $lt: MAX_ATTEMPTS } },
            { attempts: { $exists: false } },
          ],
        },
        {
          $set: {
            status: "pending",
            lastAttemptAt: attemptTime,
            lastError: null,
          },
          $inc: {
            attempts: 1,
          },
        },
        { returnDocument: "after" },
      );

      if (!retry) {
        console.log(`Notification skipped: ${trainer.email}`);
        continue;
      }

      console.log(`Retry attempt ${retry.attempts}: ${trainer.email}`);
    }

    console.log(`Processing notifications for ${trainer.email}`);

    try {
      await sendEmail(
        trainer.email,
        "LMS - Notification",
        "<p>Bonjour, vous avez une nouvelle notification LMS.</p>",
      );

      await NotificationDelivery.updateOne(deliveryKey, {
        $set: {
          status: "sent",
          lastError: null,
        },
      });

      console.log("Notification sent to:", trainer.email);
    } catch (error) {
      await NotificationDelivery.updateOne(deliveryKey, {
        $set: {
          status: "failed",
          lastError: error.message,
        },
      });

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

// ==========================================
// INACTIVE LEARNER REMINDERS
// Abdelilah's existing handler
// ==========================================

export const processInactiveLearnerReminders = async () => {
  const inactiveDays = Number(process.env.INACTIVE_DAYS || 14);

  if (!Number.isInteger(inactiveDays) || inactiveDays < 1) {
    throw new Error("INACTIVE_DAYS must be a positive integer");
  }

  const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

  const enrollments = await Enrollment.find({
    status: "active",
  })
    .populate("learner", "name email accountStatus role")
    .populate("course", "title");

  const learners = new Map();
  let skipped = 0;

  // Group active enrollments by learner
  for (const enrollment of enrollments) {
    const learner = enrollment.learner;

    if (!learner) {
      skipped++;
      continue;
    }

    const key = learner._id.toString();

    if (!learners.has(key)) {
      learners.set(key, {
        learner,
        courseTitles: new Set(),
        latestEnrollmentAt: enrollment.enrolledAt || enrollment.createdAt,
      });
    }

    const data = learners.get(key);

    const enrollmentDate = enrollment.enrolledAt || enrollment.createdAt;

    if (
      enrollmentDate &&
      (!data.latestEnrollmentAt ||
        new Date(enrollmentDate) > new Date(data.latestEnrollmentAt))
    ) {
      data.latestEnrollmentAt = enrollmentDate;
    }

    if (enrollment.course?.title) {
      data.courseTitles.add(enrollment.course.title);
    }
  }

  let selected = 0;
  let sent = 0;
  let failed = 0;

  for (const data of learners.values()) {
    const { learner, courseTitles, latestEnrollmentAt } = data;

    if (
      learner.role !== "learner" ||
      learner.accountStatus !== "active" ||
      !learner.email
    ) {
      skipped++;
      continue;
    }

    const latestProgress = await Progress.findOne({
      learner: learner._id,
    })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean();

    let lastActivityAt = latestProgress?.updatedAt;

    if (
      latestEnrollmentAt &&
      (!lastActivityAt ||
        new Date(latestEnrollmentAt) > new Date(lastActivityAt))
    ) {
      lastActivityAt = latestEnrollmentAt;
    }

    if (!lastActivityAt || new Date(lastActivityAt) > cutoff) {
      skipped++;
      continue;
    }

    selected++;

    try {
      await sendEmail(
        learner.email,
        "We miss you at LMS",
        inactiveLearnerReminderEmail(
          learner.name,
          [...courseTitles],
          inactiveDays,
        ),
      );

      sent++;
    } catch (emailError) {
      failed++;

      console.error(
        `Failed to send inactive learner reminder to ${learner.email}:`,
        emailError.message,
      );
    }
  }

  return {
    selected,
    sent,
    failed,
    skipped,
  };
};
