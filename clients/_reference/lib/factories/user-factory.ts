/**
 * UserFactory — Data factory for reference client test scenarios.
 * Uses DataHelper to generate realistic, isolated test data per VU.
 */

import { DataHelper } from "../../../../src/helpers/data-helper";
import { User } from "../services/user-service";

export class UserFactory {
  /** Generate a random user for load testing */
  static random(): User {
    const user = DataHelper.randomUser();
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: "user",
    };
  }

  /** Generate N random users */
  static bulk(count: number): User[] {
    return Array.from({ length: count }, () => UserFactory.random());
  }

  /** Generate a user with a specific role */
  static withRole(role: "admin" | "user" | "readonly"): User {
    const user = UserFactory.random();
    return { ...user, role };
  }
}
