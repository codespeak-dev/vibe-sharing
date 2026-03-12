import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
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

    // ─── Shared Lambda config ───
    const lambdaDir = path.join(__dirname, "..", "lambda");
    const sharedEnv = {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: bucket.bucketName,
      UPLOAD_PREFIX,
    };
    const sharedProps: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: sharedEnv,
      bundling: {
        minify: true,
        sourceMap: true,
      },
    };

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

    // ─── Health Lambda ───
    const healthFn = new lambdaNode.NodejsFunction(this, "HealthFunction", {
      ...sharedProps,
      entry: path.join(lambdaDir, "health", "index.ts"),
      handler: "handler",
      environment: {}, // no env needed
    });

    // ─── API Gateway HTTP API ───
    const api = new apigatewayv2.HttpApi(this, "VibeShareApi", {
      description: "codespeak-vibe-share upload API",
      corsPreflight: {
        allowOrigins: config.corsAllowedOrigins,
        allowMethods: [
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.GET,
        ],
        allowHeaders: ["Content-Type"],
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

    // ─── Throttling ───
    // HTTP API v2 throttling is set on the stage
    const stage = api.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
    if (stage) {
      stage.defaultRouteSettings = {
        throttlingBurstLimit: 10,
        throttlingRateLimit: 5,
      };
    }

    // ─── Monitoring ───
    const alarmTopic = new sns.Topic(this, "AlarmTopic", {
      displayName: "VibeShare Alarms",
    });
    alarmTopic.addSubscription(
      new snsSubscriptions.EmailSubscription(config.alarmEmail)
    );

    // Slack notification Lambda (reads webhook URL from SSM at runtime)
    const slackWebhookParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      "SlackWebhookParam",
      { parameterName: config.slackWebhookSsmParam }
    );

    const slackNotifyFn = new lambdaNode.NodejsFunction(this, "SlackNotifyFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      entry: path.join(lambdaDir, "slack-notify", "index.ts"),
      handler: "handler",
      environment: {
        SLACK_WEBHOOK_SSM_PARAM: config.slackWebhookSsmParam,
      },
      bundling: { minify: true, sourceMap: true },
    });

    slackWebhookParam.grantRead(slackNotifyFn);
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
  }
}
