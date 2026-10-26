import Enrollment from "../models/Enrollment.js";
import Course from "../models/course.js";

import User from "../models/User.js";
import { sendEmail } from "../services/emailService.js";
import { courseEnrollmentEmail } from "../services/emailTemplates.js";

// POST /api/courses/:courseId/enroll
export const enrollCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const learnerId = req.user.id;

    // 1. Verify course exists and is published
    // const course = await Course.findById(courseId);
    // if (!course) {
    //   return res.status(404).json({ message: "Course not found" });
    // }
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        message: "Course not found",
      });
    }

    if (course.status !== "published") {
      return res.status(400).json({
        message: "Cannot enroll in an unpublished course",
      });
    }

    // 2. Check if user already has an active enrollment
    const existingEnrollment = await Enrollment.findOne({
      learner: learnerId,
      course: courseId,
      status: "active",
    });

    if (existingEnrollment) {
      return res
        .status(409)
        .json({ message: "You are already actively enrolled in this course" });
    }

    const enrollment = await Enrollment.create({
      learner: learnerId,
      course: courseId,
      status: "active",
    });

    try {
      const learner = await User.findById(learnerId).select("name email");

      if (learner?.email) {
        await sendEmail(
          learner.email,
          `Enrollment confirmed: ${course.title}`,
          courseEnrollmentEmail(learner.name, course.title),
        );
      }
    } catch (emailError) {
      console.error("Failed to send enrollment email:", emailError.message);
    }

    res.status(201).json({
      message: "Successfully enrolled in course",
      enrollment,
    });
  } catch (error) {
    // Handle Mongoose duplicate key error if race conditions occur
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: "Active enrollment already exists" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// GET /api/learners/me/enrollments
export const getMyEnrollments = async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ learner: req.user.id })
      .populate("course", "title description status")
      .sort({ createdAt: -1 });

    res.status(200).json({ enrollments });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// PATCH /api/enrollments/:id/cancel
export const cancelEnrollment = async (req, res) => {
  try {
    const { id } = req.params;
    const learnerId = req.user.id;

    const enrollment = await Enrollment.findOne({
      _id: id,
      learner: learnerId,
    });
    if (!enrollment) {
      return res.status(404).json({ message: "Enrollment not found" });
    }

    if (enrollment.status === "dropped") {
      return res.status(400).json({ message: "Enrollment already cancelled" });
    }

    enrollment.status = "dropped";
    await enrollment.save();

    res
      .status(200)
      .json({ message: "Enrollment cancelled successfully", enrollment });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
