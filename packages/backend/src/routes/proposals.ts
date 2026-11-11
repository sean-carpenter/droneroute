import { Router } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateProposal } from "../services/proposalValidation.js";
import {
  createProposal,
  deleteProposal,
  getProposal,
  listProposals,
  setProposalStatus,
} from "../services/proposalStore.js";

export const proposalRoutes = Router();

// Every route works on the signed-in user's own proposals only
proposalRoutes.use(authMiddleware);

proposalRoutes.get("/", (req: AuthRequest, res) => {
  res.json(listProposals(req.userId!));
});

proposalRoutes.get("/:id", (req: AuthRequest, res) => {
  const proposal = getProposal(req.userId!, String(req.params.id));
  if (!proposal) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  res.json(proposal);
});

proposalRoutes.post("/", (req: AuthRequest, res) => {
  const result = validateProposal(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json(createProposal(req.userId!, result.proposal));
});

proposalRoutes.patch("/:id", (req: AuthRequest, res) => {
  const status = req.body?.status;
  if (status !== "pending" && status !== "accepted" && status !== "dismissed") {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  if (!setProposalStatus(req.userId!, String(req.params.id), status)) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  res.json({ status });
});

proposalRoutes.delete("/:id", (req: AuthRequest, res) => {
  if (!deleteProposal(req.userId!, String(req.params.id))) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  res.json({ message: "Proposal deleted" });
});
