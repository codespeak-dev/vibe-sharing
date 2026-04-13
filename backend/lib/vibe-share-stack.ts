import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigatewayv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as path from "path";
import { config } from "./config";

const UPLOAD_PREFIX = "uploads/";

export class VibeShareStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── S3 Bucket ───
    const bucket = new s3.Bucket(this, "UploadBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: config.s3CorsAllowedOrigins,
          allowedHeaders: ["Content-Type", "Content-Length"],
          maxAge: 3600,
        },
      ],
    });

    // ─── DynamoDB Table ───
    const table = new dynamodb.Table(this, "UploadsTable", {
      partitionKey: { name: "uploadId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    // ─── Slack Threads Table ───
    const slackThreadsTable = new dynamodb.Table(this, "SlackThreadsTable", {
      partitionKey: { name: "groupKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "expiresAt",
    });

    // ─── Internal Emails Table ───
    const internalEmailsTable = new dynamodb.Table(this, "InternalEmailsTable", {
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── Cognito User Pool ───
    const userPool = new cognito.UserPool(this, "WebUiUserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolDomain = new cognito.UserPoolDomain(this, "WebUiUserPoolDomain", {
      userPool,
      cognitoDomain: { domainPrefix: config.cognitoDomainPrefix },
    });

    const userPoolClient = new cognito.UserPoolClient(this, "WebUiUserPoolClient", {
      userPool,
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ["https://admin.vibe-share.codespeak.dev/callback.html"],
        logoutUrls: ["https://admin.vibe-share.codespeak.dev/"],
      },
      authFlows: { userSrp: true },
    });

    // ─── Shared Lambda config ───
    const lambdaDir = path.join(__dirname, "..", "lambda");
    const sharedEnv = {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: bucket.bucketName,
      UPLOAD_PREFIX,
    };
    const sharedProps: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: sharedEnv,
      bundling: {
        minify: true,
        sourceMap: true,
      },
    };

    // ─── Pre Sign-up trigger (restrict to @codespeak.dev) ───
    const preSignUpFn = new lambdaNode.NodejsFunction(this, "PreSignUpFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      entry: path.join(lambdaDir, "pre-sign-up", "index.ts"),
      handler: "handler",
      bundling: { minify: true, sourceMap: true },
    });

    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);

    // ─── Upload Events Topic (Slack-only, no email) ───
    const uploadEventsTopic = new sns.Topic(this, "UploadEventsTopic", {
      displayName: "VibeShare Upload Events",
    });

    // ─── Presign Lambda ───
    const presignFn = new lambdaNode.NodejsFunction(this, "PresignFunction", {
      ...sharedProps,
      entry: path.join(lambdaDir, "presign", "index.ts"),
      handler: "handler",
      environment: {
        ...sharedEnv,
        PRESIGN_EXPIRY_SECONDS: "300",
        UPLOAD_EVENTS_TOPIC_ARN: uploadEventsTopic.topicArn,
      },
    });

    // Presign needs: PutObject on S3 (to generate presigned URLs) + PutItem on DynamoDB
    bucket.grantPut(presignFn, `${UPLOAD_PREFIX}*`);
    table.grant(presignFn, "dynamodb:PutItem");
    uploadEventsTopic.grantPublish(presignFn);

    // ─── Confirm Lambda ───
    const confirmFn = new lambdaNode.NodejsFunction(this, "ConfirmFunction", {
      ...sharedProps,
      entry: path.join(lambdaDir, "confirm", "index.ts"),
      handler: "handler",
      environment: {
        ...sharedEnv,
        UPLOAD_EVENTS_TOPIC_ARN: uploadEventsTopic.topicArn,
      },
    });

    // Confirm needs: HeadObject on S3 (requires s3:GetObject) + GetItem/UpdateItem on DynamoDB
    confirmFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.arnForObjects(`${UPLOAD_PREFIX}*`)],
      })
    );
    table.grant(confirmFn, "dynamodb:GetItem", "dynamodb:UpdateItem");
    uploadEventsTopic.grantPublish(confirmFn);

    // ─── List Uploads Lambda ───
    const listUploadsFn = new lambdaNode.NodejsFunction(this, "ListUploadsFunction", {
      ...sharedProps,
      entry: path.join(lambdaDir, "list-uploads", "index.ts"),
      handler: "handler",
    });

    table.grant(listUploadsFn, "dynamodb:Scan");
    listUploadsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.arnForObjects(`${UPLOAD_PREFIX}*`)],
      })
    );

    // ─── List Files Lambda (ZIP central directory reader) ───
    const listFilesFn = new lambdaNode.NodejsFunction(this, "ListFilesFunction", {
      ...sharedProps,
      entry: path.join(lambdaDir, "list-files", "index.ts"),
      handler: "handler",
    });

    table.grant(listFilesFn, "dynamodb:GetItem");
    listFilesFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.arnForObjects(`${UPLOAD_PREFIX}*`)],
      })
    );

    // ─── Update Upload Lambda ───
    const updateUploadFn = new lambdaNode.NodejsFunction(this, "UpdateUploadFunction", {
      ...sharedProps,
      entry: path.join(lambdaDir, "update-upload", "index.ts"),
      handler: "handler",
    });

    table.grant(updateUploadFn, "dynamodb:UpdateItem");

    // ─── Internal Emails Lambda ───
    const internalEmailsFn = new lambdaNode.NodejsFunction(this, "InternalEmailsFunction", {
      ...sharedProps,
      entry: path.join(lambdaDir, "internal-emails", "index.ts"),
      handler: "handler",
      environment: {
        INTERNAL_EMAILS_TABLE_NAME: internalEmailsTable.tableName,
      },
    });
    internalEmailsTable.grantReadWriteData(internalEmailsFn);

    // ─── List Slack Threads Lambda ───
    const listSlackThreadsFn = new lambdaNode.NodejsFunction(this, "ListSlackThreadsFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      entry: path.join(lambdaDir, "list-slack-threads", "index.ts"),
      handler: "handler",
      environment: {
        SLACK_THREADS_TABLE_NAME: slackThreadsTable.tableName,
      },
      bundling: { minify: true, sourceMap: true },
    });

    slackThreadsTable.grant(listSlackThreadsFn, "dynamodb:Scan");

    // ─── Health Lambda ───
    const healthFn = new lambdaNode.NodejsFunction(this, "HealthFunction", {
      ...sharedProps,
      entry: path.join(lambdaDir, "health", "index.ts"),
      handler: "handler",
      environment: {}, // no env needed
    });

    // ─── JWT Authorizer (Cognito) ───
    const jwtAuthorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] }
    );

    // ─── API Gateway HTTP API ───
    const api = new apigatewayv2.HttpApi(this, "VibeShareApi", {
      description: "codespeak-vibe-share upload API",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.PATCH,
        ],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // Routes
    api.addRoutes({
      path: "/api/v1/presign",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "PresignIntegration",
        presignFn
      ),
    });

    api.addRoutes({
      path: "/api/v1/confirm",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "ConfirmIntegration",
        confirmFn
      ),
    });

    api.addRoutes({
      path: "/health",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "HealthIntegration",
        healthFn
      ),
    });

    api.addRoutes({
      path: "/api/v1/uploads",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "ListUploadsIntegration",
        listUploadsFn
      ),
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/api/v1/slack-threads",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "ListSlackThreadsIntegration",
        listSlackThreadsFn
      ),
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/api/v1/uploads/{uploadId}",
      methods: [apigatewayv2.HttpMethod.PATCH],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "UpdateUploadIntegration",
        updateUploadFn
      ),
      authorizer: jwtAuthorizer,
    });

    api.addRoutes({
      path: "/api/v1/uploads/{uploadId}/files",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "ListFilesIntegration",
        listFilesFn
      ),
      authorizer: jwtAuthorizer,
    });

    const internalEmailsIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      "InternalEmailsIntegration",
      internalEmailsFn
    );

    api.addRoutes({
      path: "/api/v1/internal-emails",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: internalEmailsIntegration,
      authorizer: jwtAuthorizer,
    });
    api.addRoutes({
      path: "/api/v1/internal-emails",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: internalEmailsIntegration,
      authorizer: jwtAuthorizer,
    });
    api.addRoutes({
      path: "/api/v1/internal-emails",
      methods: [apigatewayv2.HttpMethod.DELETE],
      integration: internalEmailsIntegration,
      authorizer: jwtAuthorizer,
    });

    // ─── Throttling ───
    // HTTP API v2 throttling is set on the stage
    const stage = api.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
    if (stage) {
      stage.defaultRouteSettings = {
        throttlingBurstLimit: 10,
        throttlingRateLimit: 5,
      };
    }

    // ─── Custom Domain (vibe-share.codespeak.dev) ───
    const cert = new acm.Certificate(this, "ApiCert", {
      domainName: "vibe-share.codespeak.dev",
      validation: acm.CertificateValidation.fromDns(), // Manual DNS validation at registrar
    });

    const customDomain = new apigatewayv2.DomainName(this, "ApiDomain", {
      domainName: "vibe-share.codespeak.dev",
      certificate: cert,
    });

    new apigatewayv2.ApiMapping(this, "ApiMapping", {
      api,
      domainName: customDomain,
      stage: api.defaultStage!,
    });

    // ─── Web UI (S3 + CloudFront) ───
    const webUiBucket = new s3.Bucket(this, "WebUiBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const webUiCert = acm.Certificate.fromCertificateArn(
      this,
      "WebUiCert",
      "arn:aws:acm:us-east-1:703825340529:certificate/b7cb671e-e87d-4079-8691-9aeffa939a42"
    );

    const webUiDistribution = new cloudfront.Distribution(this, "WebUiDistribution", {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(webUiBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: ["admin.vibe-share.codespeak.dev"],
      certificate: webUiCert,
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });

    new s3deploy.BucketDeployment(this, "WebUiDeployment", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "web-ui"))],
      destinationBucket: webUiBucket,
      distribution: webUiDistribution,
      distributionPaths: ["/*"],
    });

    // ─── Monitoring ───
    const alarmTopic = new sns.Topic(this, "AlarmTopic", {
      displayName: "VibeShare Alarms",
    });
    alarmTopic.addSubscription(
      new snsSubscriptions.EmailSubscription(config.alarmEmail)
    );

    // Slack notification Lambda (uses Slack Web API for threading)
    const slackBotTokenParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      "SlackBotTokenParam",
      { parameterName: config.slackBotTokenSsmParam }
    );
    const slackChannelIdParam = ssm.StringParameter.fromStringParameterAttributes(
      this,
      "SlackChannelIdParam",
      { parameterName: config.slackChannelIdSsmParam }
    );

    const slackNotifyFn = new lambdaNode.NodejsFunction(this, "SlackNotifyFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(15),
      entry: path.join(lambdaDir, "slack-notify", "index.ts"),
      handler: "handler",
      environment: {
        SLACK_BOT_TOKEN_SSM_PARAM: config.slackBotTokenSsmParam,
        SLACK_CHANNEL_ID_SSM_PARAM: config.slackChannelIdSsmParam,
        SLACK_THREADS_TABLE_NAME: slackThreadsTable.tableName,
        INTERNAL_EMAILS_TABLE_NAME: internalEmailsTable.tableName,
        ADMIN_UI_URL: config.adminUiUrl,
      },
      bundling: { minify: true, sourceMap: true },
    });

    slackBotTokenParam.grantRead(slackNotifyFn);
    slackChannelIdParam.grantRead(slackNotifyFn);
    slackThreadsTable.grantReadWriteData(slackNotifyFn);
    internalEmailsTable.grantReadData(slackNotifyFn);
    alarmTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(slackNotifyFn)
    );
    uploadEventsTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(slackNotifyFn)
    );

    const alarmAction = new cloudwatchActions.SnsAction(alarmTopic);

    // Lambda error alarms
    for (const [name, fn] of [
      ["Presign", presignFn],
      ["Confirm", confirmFn],
      ["SlackNotify", slackNotifyFn],
    ] as const) {
      const alarm = new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: `${name} Lambda error rate exceeded`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(alarmAction);
      alarm.addOkAction(alarmAction);
    }

    // API Gateway 4xx alarm (potential abuse)
    const api4xxAlarm = new cloudwatch.Alarm(this, "Api4xxAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "4xx",
        dimensionsMap: { ApiId: api.httpApiId },
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 50,
      evaluationPeriods: 1,
      alarmDescription: "High 4xx error rate — potential abuse or misconfigured client",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    api4xxAlarm.addAlarmAction(alarmAction);
    api4xxAlarm.addOkAction(alarmAction);

    // API Gateway 5xx alarm (backend failures)
    const api5xxAlarm = new cloudwatch.Alarm(this, "Api5xxAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "5xx",
        dimensionsMap: { ApiId: api.httpApiId },
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: "Backend 5xx errors detected",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    api5xxAlarm.addAlarmAction(alarmAction);
    api5xxAlarm.addOkAction(alarmAction);

    // ─── Outputs ───
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url ?? "UNKNOWN",
      description: "API Gateway URL",
    });

    new cdk.CfnOutput(this, "BucketName", {
      value: bucket.bucketName,
      description: "S3 bucket name",
    });

    new cdk.CfnOutput(this, "TableName", {
      value: table.tableName,
      description: "DynamoDB table name",
    });

    new cdk.CfnOutput(this, "CustomDomainTarget", {
      value: customDomain.regionalDomainName,
      description: "CNAME target for vibe-share.codespeak.dev DNS record",
    });

    new cdk.CfnOutput(this, "CustomDomainHostedZoneId", {
      value: customDomain.regionalHostedZoneId,
      description: "Hosted zone ID (for reference)",
    });

    new cdk.CfnOutput(this, "WebUiUrl", {
      value: `https://${webUiDistribution.distributionDomainName}`,
      description: "Web UI URL (CloudFront)",
    });

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID (for creating users via CLI)",
    });

    new cdk.CfnOutput(this, "CognitoClientId", {
      value: userPoolClient.userPoolClientId,
      description: "Cognito App Client ID (for web UI config)",
    });

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `${config.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
      description: "Cognito hosted UI domain",
    });
  }
}
