import mongoose from "mongoose";
import Course from "../models/course.js";
import NotificationPreference from "../models/NotificationPreference.js";

// GET the logged-in trainer's preferences
//
//GET /api/trainer/preferences
//
export const getMyPreferences = async (req, res) => {
  try {
    const trainerId = req.user.id;

    const preferences = await NotificationPreference.findOne({
      trainer: trainerId,
    });

    if (!preferences) {
      return res.status(200).json({
        enabled: true,
        courses: [],
        frequency: "daily",
      });
    }

    return res.status(200).json(preferences);
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};
//
//PUT /api/trainer/preferences
//
export const updateMyPreferences = async (req, res) => {
  try {
    const trainerId = req.user.id;

    const { enabled, frequency, courses } = req.body || {};

    // Validate enabled
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        message: "enabled must be true or false",
      });
    }

    // Validate frequency
    if (!["daily", "weekly"].includes(frequency)) {
      return res.status(400).json({
        message: "frequency must be daily or weekly",
      });
    }

    // Validate courses
    if (!Array.isArray(courses)) {
      return res.status(400).json({
        message: "courses must be an array",
      });
    }

    // Check that every course ID is valid
    for (const courseId of courses) {
      if (!mongoose.isObjectIdOrHexString(courseId)) {
        return res.status(400).json({
          message: "Invalid course ID",
        });
      }
    }

    // ObjectId hex strings identify the same course regardless of case
    const uniqueCourses = [...new Set(courses.map((courseId) => String(courseId).toLowerCase()))];

    // Find courses belonging to this trainer
    const ownedCourses = await Course.find({
      _id: { $in: uniqueCourses },
      trainer: trainerId,
    });

    if (ownedCourses.length !== uniqueCourses.length) {
      return res.status(400).json({
        message: "Some courses do not belong to this trainer or do not exist",
      });
    }

    // Save preferences or create them if missing
    const preferences = await NotificationPreference.findOneAndUpdate(
      { trainer: trainerId },
      {
        enabled: enabled,
        frequency: frequency,
        courses: uniqueCourses,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    );

    return res.status(200).json({
      message: "Preferences updated successfully",
      preferences: preferences,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getEnabledPreferences = async () => {
  const preferences = await NotificationPreference.find({
    enabled: true,
  }).populate("trainer", "name email");

  return preferences;
};
