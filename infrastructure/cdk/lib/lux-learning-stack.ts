import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
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
      generateSecret: false, // Public client (SPA/PWA)
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // Cognito Groups
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

    // ─── Secrets Manager ──────────────────────────────────────────────────────

    const dbSecret = new secretsmanager.Secret(this, 'NeonDbSecret', {
      secretName: 'lux/neon-db',
      description: 'Neon PostgreSQL connection strings',
      secretObjectValue: {
        DATABASE_URL: cdk.SecretValue.unsafePlainText('REPLACE_WITH_NEON_POOLED_URL'),
        DATABASE_URL_UNPOOLED: cdk.SecretValue.unsafePlainText('REPLACE_WITH_NEON_DIRECT_URL'),
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

    // ─── SQS ─────────────────────────────────────────────────────────────────

    const reflectionDlq = new sqs.Queue(this, 'ReflectionDLQ', {
      queueName: 'lux-reflection-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    const reflectionQueue = new sqs.Queue(this, 'ReflectionQueue', {
      queueName: 'lux-reflection-queue',
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: reflectionDlq,
        maxReceiveCount: 3,
      },
    });

    // ─── Common Lambda config ─────────────────────────────────────────────────

    const LAMBDA_DIST = path.join(__dirname, '../../../services/api/dist');

    const commonEnv: Record<string, string> = {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      DYNAMO_TABLE_PROGRESS: lessonProgressTable.tableName,
      DYNAMO_TABLE_QUIZ: quizAttemptsTable.tableName,
      DYNAMO_TABLE_REFLECTIONS: reflectionsTable.tableName,
      DYNAMO_TABLE_NOTIFS: notificationsTable.tableName,
      SQS_REFLECTION_QUEUE_URL: reflectionQueue.queueUrl,
      SES_FROM_EMAIL: 'noreply@luxlearning.com',
      BEDROCK_REGION: 'us-east-1',
      FRONTEND_URL: 'https://luxlearning.com',
    };

    const commonLambdaProps: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64, // Graviton2 — 20% cheaper
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: commonEnv,
    };

    // Helper to create Lambda from compiled dist
    const makeLambda = (id: string, handlerPath: string, extraProps?: Partial<lambda.FunctionProps>) =>
      new lambda.Function(this, id, {
        ...commonLambdaProps,
        code: lambda.Code.fromAsset(LAMBDA_DIST),
        handler: handlerPath,
        ...extraProps,
      } as lambda.FunctionProps);

    // ─── Lambda Authorizer ────────────────────────────────────────────────────

    const authorizerFn = makeLambda('AuthorizerFn', 'shared/authorizer.handler', {
      timeout: cdk.Duration.seconds(5),
    });

    const authorizer = new apigwv2Authorizers.HttpLambdaAuthorizer('JwtAuthorizer', authorizerFn, {
      responseTypes: [apigwv2Authorizers.HttpLambdaResponseType.SIMPLE],
      resultsCacheTtl: cdk.Duration.minutes(5),
      identitySource: ['$request.header.Authorization'],
    });

    // ─── API Lambdas ──────────────────────────────────────────────────────────

    const coursesFn = makeLambda('CoursesFn', 'courses/handler.handler', { memorySize: 512 });
    const lessonsFn = makeLambda('LessonsFn', 'lessons/handler.handler');
    const quizFn = makeLambda('QuizFn', 'quiz/handler.handler', { memorySize: 512 });
    const reflectionFn = makeLambda('ReflectionFn', 'reflection/handler.handler', { memorySize: 512 });
    const evaluatorFn = makeLambda('EvaluatorFn', 'evaluator/handler.handler', { memorySize: 512 });

    // SQS Consumer (Bedrock AI detection)
    const sqsConsumerFn = makeLambda('SQSConsumerFn', 'reflection/sqs-consumer.handler', {
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
    });

    // ─── IAM Permissions ──────────────────────────────────────────────────────

    // DynamoDB
    [coursesFn, lessonsFn, quizFn, reflectionFn, evaluatorFn, sqsConsumerFn].forEach((fn) => {
      lessonProgressTable.grantReadWriteData(fn);
      quizAttemptsTable.grantReadWriteData(fn);
      reflectionsTable.grantReadWriteData(fn);
      notificationsTable.grantReadWriteData(fn);
    });

    // SQS
    reflectionQueue.grantSendMessages(reflectionFn);
    reflectionQueue.grantConsumeMessages(sqsConsumerFn);

    // Bedrock
    sqsConsumerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5'],
    }));

    // SES
    evaluatorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // Secrets
    dbSecret.grantRead(coursesFn);
    dbSecret.grantRead(lessonsFn);
    dbSecret.grantRead(quizFn);
    dbSecret.grantRead(reflectionFn);
    dbSecret.grantRead(evaluatorFn);

    // SQS Event Source
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
        allowOrigins: ['https://luxlearning.com', 'http://localhost:3000'],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        maxAge: cdk.Duration.hours(24),
      },
    });

    const makeIntegration = (fn: lambda.Function) =>
      new apigwv2Integrations.HttpLambdaIntegration(`${fn.node.id}Integration`, fn);

    // Routes — Courses
    api.addRoutes({
      path: '/courses',
      methods: [apigwv2.HttpMethod.GET],
      integration: makeIntegration(coursesFn),
      authorizer,
    });
    api.addRoutes({
      path: '/courses/{courseId}',
      methods: [apigwv2.HttpMethod.GET],
      integration: makeIntegration(coursesFn),
      authorizer,
    });

    // Routes — Lessons
    api.addRoutes({
      path: '/lessons/complete',
      methods: [apigwv2.HttpMethod.POST],
      integration: makeIntegration(lessonsFn),
      authorizer,
    });
    api.addRoutes({
      path: '/lessons/progress',
      methods: [apigwv2.HttpMethod.GET],
      integration: makeIntegration(lessonsFn),
      authorizer,
    });

    // Routes — Quiz
    api.addRoutes({
      path: '/quiz/{moduleId}/submit',
      methods: [apigwv2.HttpMethod.POST],
      integration: makeIntegration(quizFn),
      authorizer,
    });
    api.addRoutes({
      path: '/quiz/{moduleId}/attempts',
      methods: [apigwv2.HttpMethod.GET],
      integration: makeIntegration(quizFn),
      authorizer,
    });

    // Routes — Reflection
    api.addRoutes({
      path: '/reflection',
      methods: [apigwv2.HttpMethod.POST],
      integration: makeIntegration(reflectionFn),
      authorizer,
    });
    api.addRoutes({
      path: '/reflection/{moduleId}',
      methods: [apigwv2.HttpMethod.GET],
      integration: makeIntegration(reflectionFn),
      authorizer,
    });

    // Routes — Evaluator (role checked inside Lambda)
    api.addRoutes({
      path: '/evaluator/reflections',
      methods: [apigwv2.HttpMethod.GET],
      integration: makeIntegration(evaluatorFn),
      authorizer,
    });
    api.addRoutes({
      path: '/evaluator/reflections/review',
      methods: [apigwv2.HttpMethod.POST],
      integration: makeIntegration(evaluatorFn),
      authorizer,
    });
    api.addRoutes({
      path: '/evaluator/students',
      methods: [apigwv2.HttpMethod.GET],
      integration: makeIntegration(evaluatorFn),
      authorizer,
    });

    // ─── SES Email Identity ───────────────────────────────────────────────────
    // NOTE: Domain must be verified manually or via Route53 in production

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
      exportName: 'LuxReflectionQueueUrl',
    });
  }
}
