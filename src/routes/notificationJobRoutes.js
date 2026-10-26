import express from "express";
import { authenticate, authorize } from "../middlewares/Auth.js";
import { runNotificationJob , runInactiveLearnerReminderJob , } from "../controllers/notificationJobController.js";

const router = express.Router();

router.post(
  "/notifications/run",
  authenticate,
  authorize("admin"),
  runNotificationJob,
);

router.post(
  "/inactive-learners/reminders/run",
  authenticate,
  authorize("admin"),
  runInactiveLearnerReminderJob,
);

export default router;
