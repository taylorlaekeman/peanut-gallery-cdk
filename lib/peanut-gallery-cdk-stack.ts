import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export class PeanutGalleryCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const ui = new PeanutGalleryUi(this);
    const api = new PeanutGalleryApi(this);
  }
}

class PeanutGalleryUi extends Construct {
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

    const distribution = new cloudfront.Distribution(this, "Cdn", {
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

class PeanutGalleryApi extends Construct {
  constructor(scope: Construct) {
    super(scope, "Api");

    const moviesTable = new dynamodb.TableV2(this, "Movies", {
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

    const lambda = new PeanutGalleryGraphqlLambda(this);
    lambda.grantMovieTablePermissions(moviesTable);

    const api = new apigateway.RestApi(this, "Gateway", {
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
      lambda.lambda,
      { requestTemplates: { "application/json": '{ "statusCode": "200" }' } }
    );

    api.root.addMethod("POST", gatewayLambdaIntegration);
  }
}

class PeanutGalleryGraphqlLambda extends Construct {
  lambda: lambda.Function;

  constructor(scope: Construct) {
    super(scope, "GraphqlLambda");

    const tmdbApiKeyParameter = new ssm.StringParameter(this, "TmdbApiKey", {
      parameterName: "PeanutGalleryTmdbApiKey",
      stringValue: "placeholder-tmdb-api-key",
    });

    new s3.Bucket(this, "GraphQLCodeBucket", {
      bucketName: "peanut-gallery-graphql-code",
    });

    this.lambda = new lambda.Function(this, "GraphqlLambda", {
      code: lambda.Code.fromInline(DEFAULT_HANDLER_CODE),
      environment: { TMDB_API_KEY: tmdbApiKeyParameter.parameterName },
      functionName: "PeanutGalleryGraphQL",
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(10),
    });

    this.lambda.addLayers(
      lambda.LayerVersion.fromLayerVersionArn(
        this,
        "ParametersAndSecretsLambdaExtension",
        "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11"
      )
    );
  }

  grantMovieTablePermissions(table: dynamodb.TableV2) {
    const policyStatement = new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:PutItem"],
      effect: iam.Effect.ALLOW,
      resources: [table.tableArn],
    });
    this.lambda.addToRolePolicy(policyStatement);
  }
}

const DEFAULT_HANDLER_CODE = `
exports.handler = async () => {
  console.log('default handler not yet overwritten');
};
`;
