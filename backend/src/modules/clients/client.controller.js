import * as clientService from "./client.service.js";
import {
  createClientSchema,
  updateClientSchema,
  clientIdParamSchema,
  listClientsQuerySchema,
} from "./client.validation.js";
import { ok, created } from "../../utils/apiResponse.js";
import { getPagination, buildPageMeta } from "../../utils/pagination.js";

export async function listClientsHandler(req, res, next) {
  try {
    const { page, pageSize, skip, take } = getPagination(req.query);
    const { status, search } = listClientsQuerySchema.parse(req.query);
    const { rows, totalCount } = await clientService.listClients({ status, search, skip, take });
    return ok(res, { rows, meta: buildPageMeta(page, pageSize, totalCount) });
  } catch (err) {
    next(err);
  }
}

export async function getClientHandler(req, res, next) {
  try {
    const { id } = clientIdParamSchema.parse(req.params);
    return ok(res, await clientService.getClientOr404(id));
  } catch (err) {
    next(err);
  }
}

export async function createClientHandler(req, res, next) {
  try {
    const body = createClientSchema.parse(req.body);
    const client = await clientService.createClient(req.user, body);
    return created(res, client);
  } catch (err) {
    next(err);
  }
}

export async function updateClientHandler(req, res, next) {
  try {
    const { id } = clientIdParamSchema.parse(req.params);
    const body = updateClientSchema.parse(req.body);
    const client = await clientService.updateClient(req.user, id, body);
    return ok(res, client);
  } catch (err) {
    next(err);
  }
}
