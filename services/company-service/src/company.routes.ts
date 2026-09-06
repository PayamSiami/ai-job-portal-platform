import { Router } from "express";
import { requireInternalToken } from "@portal/shared";
import * as controller from "./company.controller.js";

const router = Router();

// Authenticated (gateway injects x-user-*)
router.put("/", controller.upsertCompany); // employer creates/updates own company
router.get("/mine", controller.getMyCompany);
router.post("/logo", controller.uploadLogo);

// Public
router.get("/slug/:slug", controller.getCompanyBySlug);
router.get("/logos/:filename", controller.serveLogo);

// Internal
router.get("/internal/by-owner", requireInternalToken, controller.internalGetByOwner);

export default router;
