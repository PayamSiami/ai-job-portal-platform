import { Router } from "express";
import { requireInternalToken } from "@portal/shared";
import * as controller from "./resume.controller.js";

const router = Router();

// Authenticated (gateway injects x-user-*)
router.post("/", controller.createResume);
router.get("/mine", controller.listMine);
router.get("/:id/pdf", controller.exportPdf);
router.get("/:id", controller.getResume);
router.put("/:id", controller.updateResume);
router.delete("/:id", controller.deleteResume);
router.patch("/:id/primary", controller.setPrimary);

// Internal (x-internal-token, ownership via ?userId=)
router.get("/internal/:id", requireInternalToken, controller.internalGet);
router.get("/internal/:id/content", requireInternalToken, controller.internalContent);

export default router;
