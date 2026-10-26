import { processNotifications , processInactiveLearnerReminders , } from "../services/notificationJobService.js";
import { executeNotificationJob } from "../services/notificationJobRunner.js";

export const runNotificationJob = async (req, res) => {
  try {
    const result = await executeNotificationJob("manual");

    return res.status(200).json({
      message: "Notification job executed successfully",
      processed: result.processed,
    });
  } catch (error) {
    console.error("Notification job error:", error);

    return res.status(500).json({
      message: "Failed to execute notification job",
    });
  }
};


export const runInactiveLearnerReminderJob = async (req, res) => {
  try {
    const result = await processInactiveLearnerReminders();

    return res.status(200).json({
      message: "Inactive learner reminder job executed successfully",
      ...result,
    });
  } catch (error) {
    console.error("Inactive learner reminder job error:", error);

    return res.status(500).json({
      message: "Failed to execute inactive learner reminder job",
    });
  }
};


