import { expect } from 'chai';
import {
  JobEntity,
  JobRepository,
  JobStatusEnum,
  MessageTemplateEntity,
  NotificationRepository,
  NotificationTemplateEntity,
  NotificationTemplateRepository,
  SubscriberEntity,
} from '@novu/dal';
import { StepTypeEnum } from '@novu/shared';
import { SubscribersService, UserSession } from '@novu/testing';
import { v4 as uuid } from 'uuid';

import { WorkflowQueueService } from './workflow.queue.service';

let workflowQueueService: WorkflowQueueService;

describe('Workflow Queue service', () => {
  let jobRepository: JobRepository;
  let session: UserSession;
  let subscriber: SubscriberEntity;
  let subscriberService: SubscribersService;
  let template: NotificationTemplateEntity;

  beforeEach(async () => {
    workflowQueueService = new WorkflowQueueService();

    jobRepository = new JobRepository();
    session = new UserSession();
    await session.initialize();

    subscriberService = new SubscribersService(session.organization._id, session.environment._id);
    subscriber = await subscriberService.createSubscriber();

    template = await session.createTemplate();
  });

  afterEach(async () => {
    await workflowQueueService.gracefulShutdown();
  });

  it('should be initialised properly', async () => {
    expect(workflowQueueService).to.be.ok;
    expect(workflowQueueService).to.have.all.keys(
      'DEFAULT_ATTEMPTS',
      'bullConfig',
      'getBackoffStrategies',
      'queue',
      'queueScheduler',
      'worker'
    );
    expect(workflowQueueService.DEFAULT_ATTEMPTS).to.eql(3);
    expect(workflowQueueService.queue).to.deep.include({
      _events: {},
      _eventsCount: 0,
      _maxListeners: undefined,
      name: 'standard',
      jobsOpts: {
        removeOnComplete: true,
      },
    });
    expect(workflowQueueService.worker).to.deep.include({
      _eventsCount: 2,
      _maxListeners: undefined,
      name: 'standard',
      blockTimeout: 0,
      waiting: true,
      running: true,
    });
  });

  it('should a job added to the queue be updated as completed if works right', async () => {
    const transactionId = uuid();
    const _environmentId = session.environment._id;
    const _notificationId = NotificationRepository.createObjectId();
    const _organizationId = session.organization._id;
    const _subscriberId = subscriber._id;
    const _templateId = template._id;
    const _userId = session.user._id;

    // Job with fake notification template and fake notification.
    const job: Omit<JobEntity, '_id'> = {
      identifier: 'job-to-complete',
      payload: {},
      overrides: {},
      step: {
        template: {
          _environmentId,
          _organizationId,
          _creatorId: _userId,
          type: StepTypeEnum.TRIGGER,
          content: '',
        } as MessageTemplateEntity,
        _templateId,
      },
      transactionId,
      _notificationId,
      _environmentId,
      _organizationId,
      _userId,
      _subscriberId,
      status: JobStatusEnum.PENDING,
      _templateId,
      digest: undefined,
      type: StepTypeEnum.TRIGGER,
      providerId: 'sendgrid',
    };

    const jobCreated = await jobRepository.create(job);

    await workflowQueueService.addToQueue(jobCreated._id, jobCreated, 0);

    await session.awaitRunningJobs(_templateId, false, 0);

    const jobs = await jobRepository.find({ _environmentId, _organizationId });
    expect(jobs.length).to.eql(1);

    expect(jobs[0].status).to.eql(JobStatusEnum.COMPLETED);
  });

  it('should a job added to the queue be updated as failed if it fails', async () => {
    const transactionId = uuid();
    const _environmentId = session.environment._id;
    const _notificationId = NotificationRepository.createObjectId();
    const _organizationId = session.organization._id;
    const _subscriberId = subscriber._id;
    const _templateId = NotificationTemplateRepository.createObjectId();
    const _userId = session.user._id;

    // Job with fake notification template and fake notification.
    const job: Omit<JobEntity, '_id'> = {
      identifier: 'job-to-fail',
      payload: {},
      overrides: {},
      step: {
        template: {
          _environmentId,
          _organizationId,
          _creatorId: _userId,
          type: StepTypeEnum.TRIGGER,
          content: '',
        } as MessageTemplateEntity,
        _templateId,
      },
      transactionId,
      _notificationId,
      _environmentId,
      _organizationId,
      _userId,
      _subscriberId,
      status: JobStatusEnum.PENDING,
      _templateId,
      digest: undefined,
      type: StepTypeEnum.TRIGGER,
      providerId: 'sendgrid',
    };

    const jobCreated = await jobRepository.create(job);

    await workflowQueueService.addToQueue(jobCreated._id, jobCreated, 0);

    await session.awaitRunningJobs(_templateId, false, 1);
    // We pause the worker as little trick to allow the `failed` status to be updated in the callback of the worker and not having a race condition.
    await workflowQueueService.gracefulShutdown();

    const jobs = await jobRepository.find({ _environmentId, _organizationId });
    expect(jobs.length).to.eql(1);

    expect(jobs[0].status).to.eql(JobStatusEnum.FAILED);
    expect(jobs[0].error).to.deep.include({
      response: {},
      status: 400,
      message: `Cannot read properties of null (reading 'steps')`,
      name: 'ApiException',
      cause: {},
    });
  });
});
