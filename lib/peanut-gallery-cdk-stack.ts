import * as cdk from "aws-cdk-lib";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class PeanutGalleryCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const ui = new PeanutGalleryUI(this);
    const api = new PeanutGalleryAPI(this);
  }
}

function getName(
  name: string,
  { prefix = "PeanutGallery" }: { prefix?: string } = {}
): string {
  return `${prefix}${name}`;
}

class PeanutGalleryUI extends Construct {
  constructor(scope: Construct) {
    const name = getName("UI");
    super(scope, name);

    const bucket = new s3.Bucket(this, getName("Bucket", { prefix: name }), {
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

    const distribution = new cloudfront.Distribution(
      this,
      getName("Distribution", { prefix: name }),
      {
        certificate: certificatemanager.Certificate.fromCertificateArn(
          this,
          "TaylorLaekemanDomainCertificate",
          "arn:aws:acm:us-east-1:256470578440:certificate/a09f4bea-a227-4c46-bcba-2fa4719a1a03"
        ),
        defaultBehavior: {
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          origin: new origins.S3Origin(bucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        domainNames: ["peanutgallery.taylorlaekeman.com"],
      }
    );
  }
}

class PeanutGalleryAPI extends Construct {
  constructor(scope: Construct) {
    const name = getName("API");
    super(scope, name);

    const table = new dynamodb.TableV2(
      this,
      getName("MoviesTable", { prefix: name }),
      {
        globalSecondaryIndexes: [
          {
            indexName: "moviesByScore",
            partitionKey: {
              name: "year-week",
              type: dynamodb.AttributeType.STRING,
            },
            sortKey: { name: "score-id", type: dynamodb.AttributeType.STRING },
          },
        ],
        partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
        tableName: getName("MoviesTable", { prefix: name }),
      }
    );

    const graphqlLambdaS3 = new s3.Bucket(
      this,
      getName("GraphQLLambdaBucket", { prefix: name }),
      {
        bucketName: getName("GraphQLLambdaBucket", {
          prefix: name,
        }).toLowerCase(),
      }
    );

    const graphqlLambda = new lambda.Function(
      this,
      getName("GraphQLLambda", { prefix: name }),
      {
        code: lambda.Code.fromInline(DEFAULT_HANDLER_CODE),
        functionName: getName("GraphQLLambda"),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_18_X,
      }
    );
  }
}

const DEFAULT_HANDLER_CODE = `
exports.handler = async () => {
  console.log('default handler not yet overwritten');
};
`;
