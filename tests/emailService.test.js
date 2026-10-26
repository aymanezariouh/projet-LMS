import { jest } from "@jest/globals";
import { sendEmail } from "../src/services/emailService.js";

describe("sendEmail - log mode", () => {
  beforeEach(() => {
    process.env.EMAIL_DRIVER = "log";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Scenario 1: Log email information
  test("prints recipient, subject and message", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    sendEmail("ahmed@example.com", "Welcome", "Hello Ahmed");

    expect(log).toHaveBeenCalledWith("Email to:", "ahmed@example.com");
    expect(log).toHaveBeenCalledWith("Email subject:", "Welcome");
    expect(log).toHaveBeenCalledWith("Email message:", "Hello Ahmed");
  });

  // Scenario 2: Default driver is log
  test("uses log mode when EMAIL_DRIVER is not set", () => {
    delete process.env.EMAIL_DRIVER;

    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    sendEmail("ahmed@example.com", "Welcome", "Hello Ahmed");

    expect(log).toHaveBeenCalledWith("Email to:", "ahmed@example.com");
  });

  // Scenario 3: Missing recipient
  test("throws an error when recipient is missing", () => {
    expect(() => sendEmail("", "Welcome", "Hello Ahmed")).toThrow(
      "Email information is missing",
    );
  });

  // Scenario 4: Missing subject
  test("throws an error when subject is missing", () => {
    expect(() => sendEmail("ahmed@example.com", "", "Hello Ahmed")).toThrow(
      "Email information is missing",
    );
  });

  // Scenario 5: Missing message
  test("throws an error when message is missing", () => {
    expect(() => sendEmail("ahmed@example.com", "Welcome", "")).toThrow(
      "Email information is missing",
    );
  });
});