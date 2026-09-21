import { Router, type IRouter } from "express";
import healthRouter from "./health";
import challengeRouter from "./challenge";
import financialRouter from "./financial";

const router: IRouter = Router();

router.use(healthRouter);
router.use(challengeRouter);
router.use(financialRouter);

export default router;
