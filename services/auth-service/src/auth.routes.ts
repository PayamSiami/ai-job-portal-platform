import { Router } from "express";
import { requireInternalToken } from "@portal/shared";
import * as controller from "./auth.controller.js";

const router = Router();

// Public
router.post("/register", controller.register);
router.post("/login", controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);
router.post("/google", controller.googleAuth);

// Authenticated (gateway forwards x-user-* headers)
router.get("/me", controller.me);
router.post("/change-password", controller.changePassword);

// Admin: promote/demote users (no self-service path to "admin").
router.patch("/users/:id/role", controller.updateUserRole);

// Internal service-to-service
router.get("/internal/users/:id", requireInternalToken, controller.internalGetUser);

export default router;
