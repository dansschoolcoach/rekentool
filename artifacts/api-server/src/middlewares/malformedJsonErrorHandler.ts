import type { ErrorRequestHandler } from "express";

export const malformedJsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (
    error !== null
    && typeof error === "object"
    && "status" in error
    && error.status === 413
    && "type" in error
    && error.type === "entity.too.large"
  ) {
    res.status(413).json({ error: "De JSON in dit verzoek is te groot." });
    return;
  }

  if (
    error instanceof SyntaxError
    && "status" in error
    && error.status === 400
    && "type" in error
    && error.type === "entity.parse.failed"
  ) {
    res.status(400).json({ error: "De JSON in dit verzoek is ongeldig." });
    return;
  }

  next(error);
};