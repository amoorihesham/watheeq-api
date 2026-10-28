import type express from 'express';
import { AppError } from '../http/errors.js';

export const notFoundHandler: express.RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND'));
};
