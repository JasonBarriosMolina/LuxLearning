import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

export class LuxLearningStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── Cognito ──────────────────────────────────────────────────────────────

    const userPool = new cognito.UserPool(this, 'LuxUserPool', {
      userPoolName: 'lux-learning-users',
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient('LuxWebClient', {
      userPoolClientName: 'lux-web-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    new cognito.CfnUserPoolGroup(this, 'StudentGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'STUDENT',
      description: 'Estudiantes de Lux Learning',
      precedence: 10,
    });

    new cognito.CfnUserPoolGroup(this, 'EvaluatorGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'EVALUATOR',
      description: 'Evaluadores de Lux Learning',
      precedence: 5,
    });

    // ADMIN group (precedence: 1) was created manually in Cognito and already exists.
    // CDK cannot import existing Cognito groups — do not add CfnUserPoolGroup here.

    // ─── Secrets Manager ──────────────────────────────────────────────────────

    const dbSecret = new secretsmanager.Secret(this, 'NeonDbSecret', {
      secretName: 'lux/neon-db',
      description: 'Neon PostgreSQL connection strings',
      secretObjectValue: {
        DATABASE_URL: cdk.SecretValue.unsafePlainText('REPLACE_WITH_NEON_POOLED_URL'),
        DATABASE_URL_UNPOOLED: cdk.SecretValue.unsafePlainText('REPLACE_WITH_NEON_DIRECT_URL'),
      },
    });

    // VAPID keys for Web Push (private key must stay out of CloudFormation template)
    const vapidSecret = new secretsmanager.Secret(this, 'VapidSecret', {
      secretName: 'lux/vapid',
      description: 'VAPID keypair for Web Push notifications',
      secretObjectValue: {
        VAPID_PUBLIC_KEY:  cdk.SecretValue.unsafePlainText('BD-Lc9oupPptQmoDMPCjFFapaUmaEnBTpotB7zrjdLAMHWAvXlZOzGp7uhCcJQHVW1Qof9KpDb00RSkJ2AV0OFw'),
        VAPID_PRIVATE_KEY: cdk.SecretValue.unsafePlainText('SrodpnU4gkq5FH_caq4vYKP1hxz_g5iisTkCI_ONqwo'),
      },
    });

    // ─── DynamoDB Tables ──────────────────────────────────────────────────────

    const lessonProgressTable = new dynamodb.Table(this, 'LessonProgress', {
      tableName: 'LessonProgress',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const quizAttemptsTable = new dynamodb.Table(this, 'QuizAttempts', {
      tableName: 'QuizAttempts',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    quizAttemptsTable.addGlobalSecondaryIndex({
      indexName: 'moduleId-index',
      partitionKey: { name: 'moduleId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'submittedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const reflectionsTable = new dynamodb.Table(this, 'Reflections', {
      tableName: 'Reflections',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    reflectionsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'submittedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const notificationsTable = new dynamodb.Table(this, 'Notifications', {
      tableName: 'Notifications',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    const enrollmentsTable = new dynamodb.Table(this, 'Enrollments', {
      tableName: 'Enrollments',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const certificatesTable = new dynamodb.Table(this, 'Certificates', {
      tableName: 'Certificates',
      partitionKey: { name: 'certId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    certificatesTable.addGlobalSecondaryIndex({
      indexName: 'userId-courseId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'courseId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const pushSubsTable = new dynamodb.Table(this, 'PushSubscriptions', {
      tableName: 'PushSubscriptions',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const tasksTable = new dynamodb.Table(this, 'ScheduledTasks', {
      tableName: 'ScheduledTasks',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    tasksTable.addGlobalSecondaryIndex({
      indexName: 'courseId-index',
      partitionKey: { name: 'courseId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'dueDate', type: dynamodb.AttributeType.STRING },
    });

    const reportAnalysisTable = new dynamodb.Table(this, 'ReportAnalysis', {
      tableName: 'ReportAnalysis',
      partitionKey: { name: 'moduleId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const recommendationsTable = new dynamodb.Table(this, 'CurriculumRecommendations', {
      tableName: 'CurriculumRecommendations',
      partitionKey: { name: 'moduleId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── SQS ─────────────────────────────────────────────────────────────────

    const reflectionDlq = new sqs.Queue(this, 'ReflectionDLQ', {
      queueName: 'lux-reflection-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    const reflectionQueue = new sqs.Queue(this, 'ReflectionQueue', {
      queueName: 'lux-reflection-queue',
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: { queue: reflectionDlq, maxReceiveCount: 3 },
    });

    // ─── Shared NodejsFunction config ─────────────────────────────────────────

    const API_SRC = path.join(__dirname, '../../../services/api/src');

    const commonEnv: Record<string, string> = {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      DYNAMO_TABLE_PROGRESS: lessonProgressTable.tableName,
      DYNAMO_TABLE_QUIZ: quizAttemptsTable.tableName,
      DYNAMO_TABLE_REFLECTIONS: reflectionsTable.tableName,
      DYNAMO_TABLE_NOTIFS: notificationsTable.tableName,
      DYNAMO_TABLE_ENROLLMENTS: enrollmentsTable.tableName,
      DYNAMO_TABLE_CERTIFICATES: certificatesTable.tableName,
      SQS_REFLECTION_QUEUE_URL: reflectionQueue.queueUrl,
      DYNAMO_TABLE_PUSH_SUBS: pushSubsTable.tableName,
      DYNAMO_TABLE_TASKS: tasksTable.tableName,
      DYNAMO_TABLE_REPORT_ANALYSIS: reportAnalysisTable.tableName,
      DYNAMO_TABLE_RECOMMENDATIONS: recommendationsTable.tableName,
      SES_FROM_EMAIL: 'jason.rbm@gmail.com',
      BEDROCK_REGION: 'us-east-1',
      FRONTEND_URL: 'https://lux-learning-mentor.vercel.app',
      // VAPID keys resolved from Secrets Manager at deploy time (not visible in CF template)
      VAPID_PUBLIC_KEY:  '{{resolve:secretsmanager:lux/vapid:SecretString:VAPID_PUBLIC_KEY}}',
      VAPID_PRIVATE_KEY: '{{resolve:secretsmanager:lux/vapid:SecretString:VAPID_PRIVATE_KEY}}',
      VAPID_EMAIL: 'mailto:admin@luxlearning.com',
      PRISMA_QUERY_ENGINE_LIBRARY: '/var/task/libquery_engine-linux-arm64-openssl-3.0.x.so.node',
      // CloudFormation dynamic reference — resolved at deploy, encrypted in Lambda
      DATABASE_URL: '{{resolve:secretsmanager:lux/neon-db:SecretString:DATABASE_URL}}',
    };

    // Path to the generated Prisma ARM64 engine binary (cross-compiled from Windows)
    const PRISMA_ENGINE = 'libquery_engine-linux-arm64-openssl-3.0.x.so.node';

    const commonBundling: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: false,
      target: 'node20',
      format: lambdaNodejs.OutputFormat.CJS,
      externalModules: [
        // Keep only AWS SDK external (provided by Lambda runtime)
        '@aws-sdk/*',
      ],
      commandHooks: {
        beforeInstall: () => [],
        beforeBundling: () => [],
        // After esbuild bundles, copy the Prisma Linux ARM64 engine binary
        // alongside the bundle so the Lambda can find it at /var/task/
        afterBundling: (inputDir: string, outputDir: string) => [
          `node -e "require('fs').copyFileSync('${inputDir.replace(/\\/g, '/')}/node_modules/.prisma/client/${PRISMA_ENGINE}', '${outputDir.replace(/\\/g, '/')}/${PRISMA_ENGINE}')"`,
        ],
      },
    };

    const makeFn = (
      id: string,
      entry: string,
      handler = 'handler',
      extra: Partial<lambdaNodejs.NodejsFunctionProps> = {}
    ) =>
      new lambdaNodejs.NodejsFunction(this, id, {
        functionName: `lux-${id.replace(/Fn$/, '').toLowerCase()}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64, // Graviton2
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        entry: path.join(API_SRC, entry),
        handler,
        environment: commonEnv,
        bundling: commonBundling,
        ...extra,
      });

    // ─── Lambda Authorizer ────────────────────────────────────────────────────

    const authorizerFn = makeFn('AuthorizerFn', 'shared/authorizer.ts', 'handler', {
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
    });

    const authorizer = new apigwv2Authorizers.HttpLambdaAuthorizer('JwtAuthorizer', authorizerFn, {
      responseTypes: [apigwv2Authorizers.HttpLambdaResponseType.SIMPLE],
      resultsCacheTtl: cdk.Duration.minutes(5),
      identitySource: ['$request.header.Authorization'],
    });

    // ─── API Lambdas ──────────────────────────────────────────────────────────

    const coursesFn  = makeFn('CoursesFn',  'courses/handler.ts',        'handler', { memorySize: 512 });
    const lessonsFn  = makeFn('LessonsFn',  'lessons/handler.ts',        'handler', { timeout: cdk.Duration.seconds(60) });
    const quizFn     = makeFn('QuizFn',     'quiz/handler.ts',           'handler', { memorySize: 512 });
    const reflFn     = makeFn('ReflectionFn', 'reflection/handler.ts',  'handler', { memorySize: 512 });
    const evaluatorFn = makeFn('EvaluatorFn', 'evaluator/handler.ts',   'handler', { memorySize: 512, timeout: cdk.Duration.seconds(60) });
    const adminFn    = makeFn('AdminFn',    'admin/handler.ts',          'handler', { memorySize: 512 });
    const notifsFn   = makeFn('NotifsFn',   'notifications/handler.ts', 'handler');
    const certsFn    = makeFn('CertsFn',    'certificates/handler.ts',  'handler');
    const pushFn     = makeFn('PushFn',     'push/handler.ts',           'handler');
    const tasksFn    = makeFn('TasksFn',    'tasks/handler.ts',          'handler', { timeout: cdk.Duration.seconds(15) });
    const reportsFn  = makeFn('ReportsFn',  'reports/handler.ts',        'handler', { memorySize: 512, timeout: cdk.Duration.seconds(60) });

    // SQS Consumer (Bedrock AI detection)
    const sqsConsumerFn = makeFn('SQSConsumerFn', 'reflection/sqs-consumer.ts', 'handler', {
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
    });

    // Reminders Lambda (EventBridge daily trigger)
    const remindersFn = makeFn('RemindersFn', 'reminders/handler.ts', 'handler', {
      timeout: cdk.Duration.seconds(300),
      memorySize: 256,
    });

    // Nightly Analysis Lambda (EventBridge 02:00 UTC)
    const analysisFn = makeFn('AnalysisFn', 'analysis/handler.ts', 'handler', {
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
    });

    // ─── IAM Permissions ──────────────────────────────────────────────────────

    const allFns = [coursesFn, lessonsFn, quizFn, reflFn, evaluatorFn, adminFn, notifsFn, certsFn, pushFn, sqsConsumerFn, remindersFn, tasksFn, reportsFn, analysisFn];

    allFns.forEach((fn) => {
      lessonProgressTable.grantReadWriteData(fn);
      quizAttemptsTable.grantReadWriteData(fn);
      reflectionsTable.grantReadWriteData(fn);
      notificationsTable.grantReadWriteData(fn);
      enrollmentsTable.grantReadWriteData(fn);
      certificatesTable.grantReadWriteData(fn);
      pushSubsTable.grantReadWriteData(fn);
      tasksTable.grantReadWriteData(fn);
      reportAnalysisTable.grantReadWriteData(fn);
      recommendationsTable.grantReadWriteData(fn);
    });

    reflectionQueue.grantSendMessages(reflFn);
    reflectionQueue.grantConsumeMessages(sqsConsumerFn);

    sqsConsumerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    // Bedrock for student AI preview (reflection handler)
    reflFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    evaluatorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    evaluatorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    }));

    evaluatorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:ListUsersInGroup',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminUpdateUserAttributes',
      ],
      resources: [userPool.userPoolArn],
    }));

    adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // Bedrock for admin AI course generation
    adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    // Bedrock for lesson chatbot
    lessonsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    // Reminders Lambda IAM
    remindersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
    remindersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    }));

    // Reports Lambda — Cognito + SES
    reportsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    }));
    reportsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // Analysis Lambda — Bedrock + Cognito
    analysisFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0`,
      ],
    }));

    // EventBridge rule — nightly at 2:00 AM UTC
    new events.Rule(this, 'NightlyAnalysisRule', {
      ruleName: 'lux-nightly-analysis',
      description: 'Trigger analysis Lambda nightly at 2:00 AM UTC',
      schedule: events.Schedule.cron({ minute: '0', hour: '2' }),
      targets: [new eventsTargets.LambdaFunction(analysisFn)],
    });

    // EventBridge rule — daily at 9:00 AM UTC
    new events.Rule(this, 'DailyRemindersRule', {
      ruleName: 'lux-daily-reminders',
      description: 'Trigger reminders Lambda daily at 9:00 AM UTC',
      schedule: events.Schedule.cron({ minute: '0', hour: '9' }),
      targets: [new eventsTargets.LambdaFunction(remindersFn)],
    });

    certsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    }));

    allFns.forEach((fn) => {
      dbSecret.grantRead(fn);
      vapidSecret.grantRead(fn);
    });

    sqsConsumerFn.addEventSource(new lambdaEventSources.SqsEventSource(reflectionQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
      reportBatchItemFailures: true,
    }));

    // ─── API Gateway HTTP API ─────────────────────────────────────────────────

    const api = new apigwv2.HttpApi(this, 'LuxHttpApi', {
      apiName: 'lux-learning-api',
      description: 'Lux Learning REST API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        maxAge: cdk.Duration.hours(24),
      },
    });

    const i = (fn: lambda.IFunction) =>
      new apigwv2Integrations.HttpLambdaIntegration(`${fn.node.id}Int`, fn);

    const addRoute = (
      path: string,
      method: apigwv2.HttpMethod,
      fn: lambda.IFunction,
      auth = true
    ) =>
      api.addRoutes({
        path,
        methods: [method],
        integration: i(fn),
        ...(auth ? { authorizer } : {}),
      });

    // Courses
    addRoute('/courses',            apigwv2.HttpMethod.GET,  coursesFn);
    addRoute('/courses/{courseId}', apigwv2.HttpMethod.GET,  coursesFn);

    // Lessons
    addRoute('/lessons/complete',         apigwv2.HttpMethod.POST, lessonsFn);
    addRoute('/lessons/progress',         apigwv2.HttpMethod.GET,  lessonsFn);
    addRoute('/lessons/highlights',       apigwv2.HttpMethod.GET,  lessonsFn);
    addRoute('/lessons/highlights',       apigwv2.HttpMethod.POST, lessonsFn);
    addRoute('/lessons/favorites',        apigwv2.HttpMethod.GET,  lessonsFn);
    addRoute('/lessons/favorites/toggle', apigwv2.HttpMethod.POST, lessonsFn);
    addRoute('/lessons/transcript',       apigwv2.HttpMethod.GET,  lessonsFn);
    addRoute('/lessons/chat',             apigwv2.HttpMethod.POST, lessonsFn);

    // Quiz
    addRoute('/quiz/{moduleId}/submit',   apigwv2.HttpMethod.POST, quizFn);
    addRoute('/quiz/{moduleId}/attempts', apigwv2.HttpMethod.GET,  quizFn);

    // Reflection
    addRoute('/reflection',            apigwv2.HttpMethod.POST, reflFn);
    addRoute('/reflection/{moduleId}', apigwv2.HttpMethod.GET,  reflFn);
    addRoute('/reflection/ai-preview', apigwv2.HttpMethod.POST, reflFn);

    // Evaluator
    addRoute('/evaluator/reflections',        apigwv2.HttpMethod.GET,  evaluatorFn);
    addRoute('/evaluator/reflections/review', apigwv2.HttpMethod.POST, evaluatorFn);
    addRoute('/evaluator/students',           apigwv2.HttpMethod.GET,  evaluatorFn);
    addRoute('/evaluator/ai-feedback',          apigwv2.HttpMethod.POST, evaluatorFn);
    addRoute('/evaluator/quiz-audit',           apigwv2.HttpMethod.GET,  evaluatorFn);
    addRoute('/evaluator/reflections/priority', apigwv2.HttpMethod.POST, evaluatorFn);
    addRoute('/evaluator/ai-check',             apigwv2.HttpMethod.POST, evaluatorFn);

    // Admin — Content Management
    addRoute('/admin/courses',                        apigwv2.HttpMethod.GET,    adminFn);
    addRoute('/admin/courses',                        apigwv2.HttpMethod.POST,   adminFn);
    addRoute('/admin/courses/ai-generate',            apigwv2.HttpMethod.POST,   adminFn);
    addRoute('/admin/courses/ai-publish',             apigwv2.HttpMethod.POST,   adminFn);
    addRoute('/admin/courses/{courseId}',             apigwv2.HttpMethod.GET,    adminFn);
    addRoute('/admin/courses/{courseId}',             apigwv2.HttpMethod.PUT,    adminFn);
    addRoute('/admin/courses/{courseId}',             apigwv2.HttpMethod.DELETE, adminFn);
    addRoute('/admin/courses/{courseId}/modules',     apigwv2.HttpMethod.POST,   adminFn);
    addRoute('/admin/modules/{moduleId}',             apigwv2.HttpMethod.PUT,    adminFn);
    addRoute('/admin/modules/{moduleId}',             apigwv2.HttpMethod.DELETE, adminFn);
    addRoute('/admin/modules/{moduleId}/lessons',     apigwv2.HttpMethod.POST,   adminFn);
    addRoute('/admin/lessons/{lessonId}',             apigwv2.HttpMethod.PUT,    adminFn);
    addRoute('/admin/lessons/{lessonId}',             apigwv2.HttpMethod.DELETE, adminFn);
    addRoute('/admin/modules/{moduleId}/questions',   apigwv2.HttpMethod.POST,   adminFn);
    addRoute('/admin/questions/{questionId}',         apigwv2.HttpMethod.PUT,    adminFn);
    addRoute('/admin/questions/{questionId}',         apigwv2.HttpMethod.DELETE, adminFn);

    // Notifications
    addRoute('/notifications',       apigwv2.HttpMethod.GET,  notifsFn);
    addRoute('/notifications/read',  apigwv2.HttpMethod.POST, notifsFn);

    // Certificates — public verification (no auth) + authenticated list + generate
    addRoute('/certificates/{certId}',    apigwv2.HttpMethod.GET,  certsFn, false); // PUBLIC
    addRoute('/my-certificates',          apigwv2.HttpMethod.GET,  certsFn);
    addRoute('/my-certificates/generate', apigwv2.HttpMethod.POST, certsFn);

    // Push Notifications
    addRoute('/push/vapid-key',  apigwv2.HttpMethod.GET,    pushFn, false); // PUBLIC — browser needs it before auth
    addRoute('/push/subscribe',  apigwv2.HttpMethod.POST,   pushFn);
    addRoute('/push/subscribe',  apigwv2.HttpMethod.DELETE, pushFn);

    // Admin — Enrollment Management
    addRoute('/admin/users/{username}/enrollments', apigwv2.HttpMethod.GET,    adminFn);
    addRoute('/admin/users/{username}/enrollments', apigwv2.HttpMethod.POST,   adminFn);
    addRoute('/admin/users/{username}/enrollments', apigwv2.HttpMethod.DELETE, adminFn);

    // Admin — User Management (ADMIN role only, enforced in handler)
    addRoute('/admin/users',                          apigwv2.HttpMethod.GET,    adminFn);
    addRoute('/admin/users',                          apigwv2.HttpMethod.POST,   adminFn);
    addRoute('/admin/users/{username}/role',          apigwv2.HttpMethod.PUT,    adminFn);
    addRoute('/admin/users/{username}/status',        apigwv2.HttpMethod.PUT,    adminFn);
    addRoute('/admin/users/{username}',               apigwv2.HttpMethod.DELETE, adminFn);

    // Admin — Reports (legacy, keep for backward compat)
    addRoute('/admin/reports', apigwv2.HttpMethod.GET, adminFn);

    // Reports (new dedicated handler)
    addRoute('/reports',                                    apigwv2.HttpMethod.GET,  reportsFn);
    addRoute('/reports/email',                              apigwv2.HttpMethod.POST, reportsFn);
    addRoute('/reports/recommendations/{moduleId}',         apigwv2.HttpMethod.GET,  reportsFn);
    addRoute('/reports/recommendations/{moduleId}',         apigwv2.HttpMethod.PUT,  reportsFn);

    // Tasks (student)
    addRoute('/tasks',                        apigwv2.HttpMethod.GET,  tasksFn);
    addRoute('/tasks/calendar.ics',           apigwv2.HttpMethod.GET,  tasksFn, false); // public — token in query param
    addRoute('/tasks/{taskId}/complete',      apigwv2.HttpMethod.POST, tasksFn);

    // Tasks (evaluator)
    addRoute('/evaluator/tasks',              apigwv2.HttpMethod.GET,    evaluatorFn);
    addRoute('/evaluator/tasks',              apigwv2.HttpMethod.POST,   evaluatorFn);
    addRoute('/evaluator/tasks/{taskId}',     apigwv2.HttpMethod.PUT,    evaluatorFn);
    addRoute('/evaluator/tasks/{taskId}',     apigwv2.HttpMethod.DELETE, evaluatorFn);

    // ─── Outputs ─────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.apiEndpoint,
      description: 'API Gateway URL',
      exportName: 'LuxApiUrl',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'LuxUserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID',
      exportName: 'LuxUserPoolClientId',
    });

    new cdk.CfnOutput(this, 'ReflectionQueueUrl', {
      value: reflectionQueue.queueUrl,
      description: 'SQS Reflection Queue URL',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbSecret.secretArn,
      description: 'Secrets Manager ARN for Neon credentials',
    });
  }
}
