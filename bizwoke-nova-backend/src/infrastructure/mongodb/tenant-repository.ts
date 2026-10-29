import type {
  ClientSession,
  FilterQuery,
  Model,
  PipelineStage,
  ProjectionType,
  Types,
  UpdateQuery,
} from 'mongoose';
import { Errors } from '../../common/errors/app-error';

export interface FindOptions {
  projection?: ProjectionType<unknown>;
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  session?: ClientSession;
}

/** Removes ownership fields so callers can never reassign tenant or identity through data. */
function stripOwnership<T extends Record<string, unknown>>(data: T): T {
  const { tenantId: _t, _id: _i, ...rest } = data as Record<string, unknown>;
  return rest as T;
}

/**
 * Tenant-scoped data access. Every operation is constrained to the tenant this
 * repository was constructed with; there is no method that accepts a tenantId per call.
 */
export class TenantRepository<TDoc> {
  constructor(
    protected readonly model: Model<TDoc>,
    public readonly tenantId: Types.ObjectId,
  ) {
    if (!tenantId) throw new Error('TenantRepository requires a tenantId (fail closed)');
  }

  scope(filter: FilterQuery<TDoc> = {}): FilterQuery<TDoc> {
    return { ...filter, tenantId: this.tenantId } as FilterQuery<TDoc>;
  }

  find(filter: FilterQuery<TDoc> = {}, opts: FindOptions = {}) {
    const q = this.model.find(this.scope(filter), opts.projection, { session: opts.session });
    if (opts.sort) q.sort(opts.sort);
    if (opts.skip) q.skip(opts.skip);
    if (opts.limit) q.limit(opts.limit);
    return q.lean<TDoc[]>();
  }

  findOne(filter: FilterQuery<TDoc>, opts: FindOptions = {}) {
    return this.model.findOne(this.scope(filter), opts.projection, { session: opts.session }).lean<TDoc>();
  }

  findById(id: string | Types.ObjectId, opts: FindOptions = {}) {
    return this.findOne({ _id: id } as FilterQuery<TDoc>, opts);
  }

  async getById(id: string | Types.ObjectId, resource: string, opts: FindOptions = {}): Promise<TDoc> {
    const doc = await this.findById(id, opts);
    // Cross-tenant ids are indistinguishable from missing ids: always 404, never 403.
    if (!doc) throw Errors.notFound(resource);
    return doc;
  }

  count(filter: FilterQuery<TDoc> = {}) {
    return this.model.countDocuments(this.scope(filter));
  }

  /** `id` lets trusted service code pre-allocate an identifier; request data can never set it. */
  async create(data: Record<string, unknown>, session?: ClientSession, id?: Types.ObjectId): Promise<TDoc> {
    const [doc] = await this.model.create(
      [{ ...stripOwnership(data), ...(id ? { _id: id } : {}), tenantId: this.tenantId }],
      {
        session,
      },
    );
    return doc!.toObject() as TDoc;
  }

  async insertMany(rows: Record<string, unknown>[], session?: ClientSession) {
    const docs = rows.map((r) => ({ ...stripOwnership(r), tenantId: this.tenantId }));
    return this.model.insertMany(docs, { session, ordered: true });
  }

  updateOne(filter: FilterQuery<TDoc>, update: UpdateQuery<TDoc>, session?: ClientSession) {
    return this.model.updateOne(this.scope(filter), this.safeUpdate(update), {
      session,
      runValidators: true,
    });
  }

  findOneAndUpdate(filter: FilterQuery<TDoc>, update: UpdateQuery<TDoc>, opts: FindOptions = {}) {
    return this.model
      .findOneAndUpdate(this.scope(filter), this.safeUpdate(update), {
        new: true,
        runValidators: true,
        projection: opts.projection,
        session: opts.session,
      })
      .lean<TDoc>();
  }

  updateMany(filter: FilterQuery<TDoc>, update: UpdateQuery<TDoc>, session?: ClientSession) {
    return this.model.updateMany(this.scope(filter), this.safeUpdate(update), {
      session,
      runValidators: true,
    });
  }

  deleteOne(filter: FilterQuery<TDoc>, session?: ClientSession) {
    return this.model.deleteOne(this.scope(filter), { session });
  }

  deleteMany(filter: FilterQuery<TDoc>, session?: ClientSession) {
    return this.model.deleteMany(this.scope(filter), { session });
  }

  /** Aggregations always start with a tenant $match; caller stages run after it. */
  aggregate<R = unknown>(pipeline: PipelineStage[]) {
    return this.model.aggregate<R>([{ $match: { tenantId: this.tenantId } }, ...pipeline]);
  }

  private safeUpdate(update: UpdateQuery<TDoc>): UpdateQuery<TDoc> {
    const u = { ...(update as Record<string, unknown>) };
    if (u.$set) u.$set = stripOwnership(u.$set as Record<string, unknown>);
    if (u.$setOnInsert) u.$setOnInsert = stripOwnership(u.$setOnInsert as Record<string, unknown>);
    delete u.tenantId;
    return u as UpdateQuery<TDoc>;
  }
}
