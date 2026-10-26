import NotificationPreference from "../models/NotificationPreference.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { getNotificationPeriod } from "../utils/notificationPeriod.js";

import Enrollment from "../models/Enrollment.js";
import Progress from "../models/progress.js";
import { sendEmail } from "./emailService.js";
import { inactiveLearnerReminderEmail } from "./emailTemplates.js";

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

    console.log("Frequency:", preference.frequency);
    console.log("Courses:", preference.courses);

    processed++;
  }

  return {
    processed: processed,
  };
};



export const processInactiveLearnerReminders = async () => {
  const inactiveDays = Number(process.env.INACTIVE_DAYS || 14);

  if (!Number.isInteger(inactiveDays) || inactiveDays < 1) {
    throw new Error("INACTIVE_DAYS must be a positive integer");
  }

  const cutoff = new Date(
    Date.now() - inactiveDays * 24 * 60 * 60 * 1000,
  );

  const enrollments = await Enrollment.find({
    status: "active",
  })
    .populate("learner", "name email accountStatus role")
    .populate("course", "title");

  const learners = new Map();
  let skipped = 0;

  // Group active enrollments by learner to avoid duplicate reminder emails.
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
        latestEnrollmentAt:
          enrollment.enrolledAt || enrollment.createdAt,
      });
    }

    const data = learners.get(key);
    const enrollmentDate =
      enrollment.enrolledAt || enrollment.createdAt;

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

    // Use the real progress update timestamp as the activity signal.
    const latestProgress = await Progress.findOne({
      learner: learner._id,
    })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean();

    let lastActivityAt = latestProgress?.updatedAt;

    // If the learner has no recent progress, also consider enrollment dates.
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
