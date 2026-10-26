import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { hash } from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Course from "../src/models/course.js";
import NotificationPreference from "../src/models/NotificationPreference.js";

const endpoint = "/api/trainer/preferences";
// Every run owns a separate database, even when MONGO_URI points to development.
const databaseName = `lms_prefs_test_${new mongoose.Types.ObjectId()}`;
const password = "PrefsTest123!";
let trainer, otherTrainer, learner, admin, suspendedTrainer;
let course, secondCourse, foreignCourse;
const tokens = {};

function putPreferences(body, token = tokens.trainer) {
  return request(app)
    .put(endpoint)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function validBody(overrides = {}) {
  return {
    enabled: true,
    frequency: "daily",
    courses: [course.id],
    ...overrides,
  };
}

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://[::1]:27017/lms", {
    dbName: databaseName,
    serverSelectionTimeoutMS: 5000,
  });
  await NotificationPreference.init();

  const hashedPassword = await hash(password, 10);
  [trainer, otherTrainer, learner, admin, suspendedTrainer] = await User.create(
    [
      ["trainer", "trainer", "active"],
      ["otherTrainer", "trainer", "active"],
      ["learner", "learner", "active"],
      ["admin", "admin", "active"],
      ["suspendedTrainer", "trainer", "suspended"],
    ].map(([name, role, accountStatus]) => ({
      name,
      email: `${name.toLowerCase()}@prefs.example.invalid`,
      password: hashedPassword,
      role,
      accountStatus,
    })),
  );

  for (const user of [trainer, otherTrainer, learner, admin, suspendedTrainer]) {
    const response = await request(app).post("/api/auth/login").send({
      email: user.email,
      password,
    });
    expect(response.statusCode).toBe(200);
    tokens[user.name] = response.body.token;
  }

  [course, secondCourse, foreignCourse] = await Course.create(
    [trainer, trainer, otherTrainer].map((owner, index) => ({
      title: `PREFS course ${index}`,
      description: "Notification preference fixture",
      objectives: ["Test course selection"],
      level: "beginner",
      category: "Test",
      estimatedDuration: 1,
      trainer: owner._id,
    })),
  );
}, 20000);

beforeEach(async () => {
  await NotificationPreference.deleteMany({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  try {
    // Never drop the database named by MONGO_URI or another suite's database.
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName) {
      await mongoose.connection.dropDatabase();
    }
  } finally {
    await mongoose.disconnect();
  }
});

describe("PREFS: defaults and persistence", () => {
  test("GET returns defaults without creating a preference document", async () => {
    const response = await request(app)
      .get(endpoint)
      .set("Authorization", `Bearer ${tokens.trainer}`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ enabled: true, courses: [], frequency: "daily" });
    expect(await NotificationPreference.countDocuments()).toBe(0);
  });

  test.each(["daily", "weekly"])("PUT creates %s preferences and GET returns them", async (frequency) => {
    const response = await putPreferences(validBody({ frequency }));

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Preferences updated successfully");
    expect(response.body.preferences).toMatchObject({
      trainer: trainer.id,
      enabled: true,
      frequency,
      courses: [course.id],
    });
    expect(response.body.preferences).toHaveProperty("_id");
    expect(response.body.preferences).toHaveProperty("createdAt");
    expect(response.body.preferences).toHaveProperty("updatedAt");

    const stored = await NotificationPreference.findOne({ trainer: trainer.id });
    expect(stored.frequency).toBe(frequency);
    expect(stored.courses.map(String)).toEqual([course.id]);

    const getResponse = await request(app)
      .get(endpoint)
      .set("Authorization", `Bearer ${tokens.trainer}`);
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.body).toEqual(response.body.preferences);
  });

  test("PUT modifies the same document, disables and re-enables notifications", async () => {
    const created = await putPreferences(validBody());
    const disabled = await putPreferences(validBody({
      enabled: false, frequency: "weekly", courses: [secondCourse.id],
    }));
    expect(disabled.statusCode).toBe(200);
    expect(disabled.body.preferences).toMatchObject({
      _id: created.body.preferences._id,
      enabled: false,
      frequency: "weekly",
      courses: [secondCourse.id],
    });
    const getResponse = await request(app)
      .get(endpoint)
      .set("Authorization", `Bearer ${tokens.trainer}`);
    expect(getResponse.body.enabled).toBe(false);

    const enabled = await putPreferences(validBody({ courses: [] }));
    expect(enabled.statusCode).toBe(200);
    expect(enabled.body.preferences).toMatchObject({
      _id: created.body.preferences._id, enabled: true, frequency: "daily", courses: [],
    });
    expect(await NotificationPreference.countDocuments({ trainer: trainer.id })).toBe(1);
    expect((await NotificationPreference.findOne({ trainer: trainer.id })).enabled).toBe(true);
  });

  test("PUT can create disabled preferences with no selected courses", async () => {
    const response = await putPreferences(validBody({ enabled: false, courses: [] }));
    expect(response.statusCode).toBe(200);
    expect(response.body.preferences).toMatchObject({ enabled: false, courses: [] });
    expect((await NotificationPreference.findOne({ trainer: trainer.id })).enabled).toBe(false);
  });

  test("PUT accepts multiple courses belonging to the trainer", async () => {
    const response = await putPreferences(validBody({ courses: [course.id, secondCourse.id] }));
    expect(response.statusCode).toBe(200);
    expect(response.body.preferences.courses).toEqual([course.id, secondCourse.id]);
  });

  test("PUT deduplicates repeated course IDs", async () => {
    const response = await putPreferences(validBody({ courses: [course.id, course.id, secondCourse.id] }));
    expect(response.statusCode).toBe(200);
    expect(response.body.preferences.courses).toEqual([course.id, secondCourse.id]);
  });

  test("PUT treats upper- and lowercase hex as the same course ID", async () => {
    const response = await putPreferences(validBody({ courses: [course.id, course.id.toUpperCase()] }));
    expect(response.statusCode).toBe(200);
    expect(response.body.preferences.courses).toEqual([course.id]);
  });

  test("trainers only read and update their own preferences, ignoring a supplied trainer ID", async () => {
    const otherResponse = await putPreferences(
      validBody({ frequency: "weekly", courses: [foreignCourse.id] }), tokens.otherTrainer,
    );
    const response = await putPreferences(validBody({ trainer: otherTrainer.id, enabled: false }));
    expect(response.statusCode).toBe(200);
    expect(response.body.preferences.trainer).toBe(trainer.id);

    const otherGet = await request(app)
      .get(`${endpoint}?trainer=${trainer.id}`)
      .set("Authorization", `Bearer ${tokens.otherTrainer}`);
    expect(otherGet.body).toEqual(otherResponse.body.preferences);
    expect(await NotificationPreference.countDocuments()).toBe(2);
  });
});

describe("PREFS: invalid input", () => {
  test.each([
    ["missing enabled", { enabled: undefined }, "enabled must be true or false"],
    ["string enabled", { enabled: "false" }, "enabled must be true or false"],
    ["numeric enabled", { enabled: 1 }, "enabled must be true or false"],
    ["null enabled", { enabled: null }, "enabled must be true or false"],
    ["missing frequency", { frequency: undefined }, "frequency must be daily or weekly"],
    ["invalid frequency", { frequency: "monthly" }, "frequency must be daily or weekly"],
    ["uppercase frequency", { frequency: "DAILY" }, "frequency must be daily or weekly"],
    ["null frequency", { frequency: null }, "frequency must be daily or weekly"],
    ["missing courses", { courses: undefined }, "courses must be an array"],
    ["string courses", { courses: "course-id" }, "courses must be an array"],
    ["null courses", { courses: null }, "courses must be an array"],
    ["object courses", { courses: {} }, "courses must be an array"],
    ["invalid ID", { courses: ["not-an-object-id"] }, "Invalid course ID"],
    ["non-hex ID", { courses: ["z".repeat(24)] }, "Invalid course ID"],
    ["numeric ID", { courses: [123] }, "Invalid course ID"],
    ["null ID", { courses: [null] }, "Invalid course ID"],
    ["object ID", { courses: [{ $ne: null }] }, "Invalid course ID"],
  ])("PUT rejects %s without saving", async (_name, overrides, message) => {
    const response = await putPreferences(validBody(overrides));
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message });
    expect(await NotificationPreference.countDocuments()).toBe(0);
  });

  test("PUT without a body returns 400 instead of a server error", async () => {
    const response = await request(app)
      .put(endpoint)
      .set("Authorization", `Bearer ${tokens.trainer}`);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message: "enabled must be true or false" });
    expect(await NotificationPreference.countDocuments()).toBe(0);
  });

  test.each(["foreign", "nonexistent", "mixed"])("PUT rejects %s courses", async (selection) => {
    const courses = selection === "foreign" ? [foreignCourse.id]
      : selection === "nonexistent" ? [new mongoose.Types.ObjectId().toString()]
      : [course.id, foreignCourse.id];
    const response = await putPreferences(validBody({ courses }));
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      message: "Some courses do not belong to this trainer or do not exist",
    });
    expect(await NotificationPreference.countDocuments()).toBe(0);
  });

  test("an invalid update leaves existing preferences unchanged", async () => {
    const created = await putPreferences(validBody());
    const response = await putPreferences(validBody({ enabled: false, courses: [foreignCourse.id] }));
    expect(response.statusCode).toBe(400);
    const getResponse = await request(app)
      .get(endpoint)
      .set("Authorization", `Bearer ${tokens.trainer}`);
    expect(getResponse.body).toEqual(created.body.preferences);
  });
});

describe.each(["get", "put"])("PREFS: %s access control", (method) => {
  function call(token) {
    const req = request(app)[method](endpoint);
    if (token) req.set("Authorization", `Bearer ${token}`);
    return method === "put" ? req.send(validBody()) : req;
  }

  test("returns 401 without authentication", async () => {
    const response = await call();
    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Access denied. No token provided.");
  });

  test("returns 401 for an invalid token", async () => {
    const response = await call("invalid-token");
    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Invalid or expired token.");
  });

  test("returns 401 for an expired token", async () => {
    const token = jwt.sign({ id: trainer.id }, process.env.JWT_SECRET || "secretkey", { expiresIn: -1 });
    const response = await call(token);
    expect(response.statusCode).toBe(401);
  });

  test.each(["learner", "admin"])("returns 403 for role %s", async (role) => {
    const response = await call(tokens[role]);
    expect(response.statusCode).toBe(403);
    expect(response.body.message).toBe("Forbidden: Insufficient permissions.");
    expect(await NotificationPreference.countDocuments()).toBe(0);
  });

  test("returns 403 for a suspended trainer", async () => {
    const response = await call(tokens.suspendedTrainer);
    expect(response.statusCode).toBe(403);
    expect(response.body.message).toBe("Account is suspended.");
  });

  test("uses the stored role even when a signed token claims trainer", async () => {
    const token = jwt.sign({ id: learner.id, role: "trainer" }, process.env.JWT_SECRET || "secretkey");
    const response = await call(token);
    expect(response.statusCode).toBe(403);
  });

  test("returns 401 for a user that no longer exists", async () => {
    const token = jwt.sign({ id: new mongoose.Types.ObjectId() }, process.env.JWT_SECRET || "secretkey");
    const response = await call(token);
    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Invalid token: user not found.");
  });
});

describe("PREFS: database errors", () => {
  test("GET keeps the existing 500 response without exposing the error", async () => {
    jest.spyOn(NotificationPreference, "findOne").mockRejectedValueOnce(new Error("private details"));
    const response = await request(app)
      .get(endpoint)
      .set("Authorization", `Bearer ${tokens.trainer}`);
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
  });

  test("PUT keeps the existing 500 response without exposing the error", async () => {
    jest.spyOn(NotificationPreference, "findOneAndUpdate").mockRejectedValueOnce(new Error("private details"));
    const response = await putPreferences(validBody());
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
  });
});
