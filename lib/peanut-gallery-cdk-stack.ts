import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as eventtargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as eventsources from "aws-cdk-lib/aws-lambda-event-sources";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as path from "path";

import { Construct } from "constructs";

export class PeanutGalleryCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const ui = new PeanutGalleryUi(this);
    const server = new PeanutGalleryServer(this);
    new DomainRouting(this, {
      api: server.api,
      uiDistribution: ui.distribution,
    });
  }
}

class PeanutGalleryUi extends Construct {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct) {
    super(scope, "Ui");

    const bucket = new s3.Bucket(this, "CodeBucket", {
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      },
      bucketName: "peanutgallery.taylorlaekeman.com",
      publicReadAccess: true,
      websiteErrorDocument: "index.html",
      websiteIndexDocument: "index.html",
    });

    this.distribution = new cloudfront.Distribution(this, "Cdn", {
      certificate: certificatemanager.Certificate.fromCertificateArn(
        this,
        "TaylorLaekemanDomainCertificate",
        "arn:aws:acm:us-east-1:256470578440:certificate/a09f4bea-a227-4c46-bcba-2fa4719a1a03"
      ),
      defaultBehavior: {
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        origin: new origins.S3Origin(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: ["peanutgallery.taylorlaekeman.com"],
    });
  }
}

class PeanutGalleryServer extends Construct {
  readonly api: apigateway.RestApi;

  constructor(scope: Construct) {
    super(scope, "Server");

    const codeBucket = new ServerCodeBucket(this);
    const movieTable = new MovieTable(this);
    const populateMovieBus = new PopulateMovieRequestBus(this);
    const parameters = new Parameters(this);
    const graphqlLambda = new GraphqlLambda(this, {
      moviePopulationRequestTopic: populateMovieBus.topic,
      movieTable: movieTable.table,
      tmdbApiKey: parameters.tmdbApiKey,
    });
    const api = new Api(this, { graphqlLambda: graphqlLambda.lambda });
    this.api = api.api;
    new MoviePopulationLambda(this, {
      moviePopulationRequestQueue: populateMovieBus.queue,
      movieTable: movieTable.table,
      tmdbApiKey: parameters.tmdbApiKey,
    });
    new MoviePopulationAutoCaller(this, { api: api.api });
  }
}

class ServerCodeBucket extends Construct {
  constructor(scope: Construct) {
    super(scope, "ServerCodeBucket");

    new s3.Bucket(this, "ServerCodeBucket", {
      bucketName: "peanut-gallery-server-code",
    });
  }
}

class MovieTable extends Construct {
  readonly table: dynamodb.TableV2;

  constructor(scope: Construct) {
    super(scope, "MovieTable");

    this.table = new dynamodb.TableV2(this, "Movies", {
      globalSecondaryIndexes: [
        {
          indexName: "moviesByScore",
          partitionKey: {
            name: "year-week",
            type: dynamodb.AttributeType.STRING,
          },
          sortKey: { name: "score-id", type: dynamodb.AttributeType.STRING },
        },
        {
          indexName: "moviesByPopularity",
          partitionKey: {
            name: "year-week",
            type: dynamodb.AttributeType.STRING,
          },
          sortKey: {
            name: "popularity-id",
            type: dynamodb.AttributeType.STRING,
          },
        },
      ],
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      tableName: "PeanutGalleryMovies",
    });
  }
}

class Parameters extends Construct {
  readonly tmdbApiKey: ssm.StringParameter;

  constructor(scope: Construct) {
    super(scope, "Parameters");
    this.tmdbApiKey = new ssm.StringParameter(this, "TmdbApiKey", {
      parameterName: "PeanutGalleryTmdbApiKey",
      stringValue: "placeholder-tmdb-api-key",
    });
  }
}

class GraphqlLambda extends Construct {
  readonly lambda: lambda.Function;

  constructor(
    scope: Construct,
    {
      moviePopulationRequestTopic,
      movieTable,
      tmdbApiKey,
    }: {
      moviePopulationRequestTopic: sns.Topic;
      movieTable: dynamodb.TableV2;
      tmdbApiKey: ssm.StringParameter;
    }
  ) {
    super(scope, "GraphqlLambda");

    this.lambda = new lambda.Function(this, "GraphqlLambda", {
      code: lambda.Code.fromInline(DEFAULT_HANDLER_CODE),
      environment: {
        CONTEXT: "graphql",
        EXECUTION_ENVIRONMENT: "lambda",
        MOVIE_TABLE_NAME: movieTable.tableName,
        MOVIE_POPULATION_REQUEST_TOPIC_ARN:
          moviePopulationRequestTopic.topicArn,
        TMDB_API_KEY: tmdbApiKey.stringValue,
      },
      functionName: "PeanutGalleryGraphQL",
      handler: "index.handler",
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ["dynamodb:Query", "dynamodb:PutItem"],
          effect: iam.Effect.ALLOW,
          resources: [movieTable.tableArn, `${movieTable.tableArn}/index/*`],
        }),
        new iam.PolicyStatement({
          actions: ["sns:Publish"],
          effect: iam.Effect.ALLOW,
          resources: [moviePopulationRequestTopic.topicArn],
        }),
      ],
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
    });

    this.lambda.addLayers(
      lambda.LayerVersion.fromLayerVersionArn(
        this,
        "ParametersAndSecretsLambdaExtension",
        "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11"
      )
    );
  }
}

class MoviePopulationLambda extends Construct {
  constructor(
    scope: Construct,
    {
      moviePopulationRequestQueue,
      movieTable,
      tmdbApiKey,
    }: {
      moviePopulationRequestQueue: sqs.Queue;
      movieTable: dynamodb.TableV2;
      tmdbApiKey: ssm.StringParameter;
    }
  ) {
    super(scope, "MoviePopulationLambda");

    const populationLambda = new lambda.Function(
      this,
      "MoviePopulationLambda",
      {
        code: lambda.Code.fromInline(DEFAULT_HANDLER_CODE),
        environment: {
          CONTEXT: "movie-population",
          EXECUTION_ENVIRONMENT: "lambda",
          MOVIE_TABLE_NAME: movieTable.tableName,
          TMDB_API_KEY: tmdbApiKey.stringValue,
        },
        events: [new eventsources.SqsEventSource(moviePopulationRequestQueue)],
        functionName: "PeanutGalleryMoviePopulationLambda",
        handler: "moviePopulationHandler.handler",
        initialPolicy: [
          new iam.PolicyStatement({
            actions: ["dynamodb:PutItem"],
            effect: iam.Effect.ALLOW,
            resources: [movieTable.tableArn],
          }),
        ],
        runtime: lambda.Runtime.NODEJS_18_X,
        timeout: cdk.Duration.seconds(30),
      }
    );

    populationLambda.addLayers(
      lambda.LayerVersion.fromLayerVersionArn(
        this,
        "ParametersAndSecretsLambdaExtension",
        "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11"
      )
    );
  }
}

class MoviePopulationAutoCaller extends Construct {
  constructor(scope: Construct, { api }: { api: apigateway.RestApi }) {
    super(scope, "MoviePopulationAutoCaller");
    new events.Rule(this, "MoviePopulationAutoCall", {
      ruleName: "MoviePopulationAutoCall",
      schedule: events.Schedule.cron({
        day: "*",
        hour: "0",
        minute: "0",
        month: "*",
      }),
      targets: [
        new eventtargets.ApiGateway(api, {
          headerParameters: { "content-type": "application/json" },
          method: "POST",
          postBody: events.RuleTargetInput.fromObject({
            operationName: "PopulateMovies",
            query:
              "mutation PopulateMovies($endDate: String, $startDate: String) {\n  populateMovies(endDate: $endDate, startDate: $startDate) {\n    initiatedIds\n    __typename\n  }\n}",
            variables: {},
          }),
        }),
      ],
    });
  }
}

class PopulateMovieRequestBus extends Construct {
  readonly topic: sns.Topic;
  readonly queue: sqs.Queue;

  constructor(scope: Construct) {
    super(scope, "PopulateMovieRequestBus");

    this.topic = new sns.Topic(this, "PopulateMovieRequestTopic", {
      topicName: "PopulateMovieRequestTopic",
    });
    const dlq = new sqs.Queue(this, "PopulateMovieRequestDLQ", {
      queueName: "PopulateMovieRequestDLQ",
    });
    this.queue = new sqs.Queue(this, "PopulateMovieRequestQueue", {
      deadLetterQueue: { maxReceiveCount: 3, queue: dlq },
      queueName: "PopulateMovieRequestQueue",
    });
    this.topic.addSubscription(new subscriptions.SqsSubscription(this.queue));
  }
}

class Api extends Construct {
  readonly api: apigateway.RestApi;

  constructor(
    scope: Construct,
    { graphqlLambda }: { graphqlLambda: lambda.Function }
  ) {
    super(scope, "Api");

    this.api = new apigateway.RestApi(this, "Gateway", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
      },
      domainName: {
        domainName: "api.peanutgallery.taylorlaekeman.com",
        certificate: certificatemanager.Certificate.fromCertificateArn(
          this,
          "TaylorLaekemanDomainCertificate",
          "arn:aws:acm:us-east-2:256470578440:certificate/2fefe87a-cad4-49fa-8885-d4d340a88a51"
        ),
      },
      restApiName: "PeanutGalleryAPI",
    });

    const gatewayLambdaIntegration = new apigateway.LambdaIntegration(
      graphqlLambda,
      { requestTemplates: { "application/json": '{ "statusCode": "200" }' } }
    );

    this.api.root.addMethod("POST", gatewayLambdaIntegration);
  }
}

class DomainRouting extends Construct {
  constructor(
    scope: Construct,
    {
      api,
      uiDistribution,
    }: { api: apigateway.RestApi; uiDistribution: cloudfront.Distribution }
  ) {
    super(scope, "DomainRouting");
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "TaylorLaekemanHostedZone",
      { hostedZoneId: "Z06013313634UKOQV70LA", zoneName: "taylorlaekeman.com" }
    );
    new route53.ARecord(this, "ApiARecord", {
      recordName: "api.peanutgallery",
      target: route53.RecordTarget.fromAlias(
        new route53targets.ApiGateway(api)
      ),
      zone: hostedZone,
    });
    new route53.ARecord(this, "UiARecord", {
      recordName: "peanutgallery",
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(uiDistribution)
      ),
      zone: hostedZone,
    });
  }
}

const DEFAULT_HANDLER_CODE = `
exports.handler = async () => {
  console.log('default handler not yet overwritten');
};
`;
