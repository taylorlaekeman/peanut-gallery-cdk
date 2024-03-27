import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class PeanutGalleryCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.TableV2(this, getName("MoviesTable"), {
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
      tableName: getName("MoviesTable"),
    });

    const graphqlLambdaS3 = new s3.Bucket(
      this,
      getName("GraphQLLambdaBucket"),
      { bucketName: getName("GraphQLLambdaBucket").toLowerCase() }
    );

    const graphqlLambda = new lambda.Function(this, getName("GraphQLLambda"), {
      code: lambda.Code.fromInline(DEFAULT_HANDLER_CODE),
      functionName: getName("GraphQLLambda"),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
    });

    const uiBucket = new s3.Bucket(this, getName("UIBucket"), {
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      },
      bucketName: "peanutgallery.taylorlaekeman.com",
      websiteErrorDocument: "index.html",
      websiteIndexDocument: "index.html",
    });

    const uiDistribution = new cloudfront.Distribution(
      this,
      getName("UIDistribution"),
      {
        defaultBehavior: {
          origin: new origins.S3Origin(uiBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      }
    );
  }
}

function getName(name: string): string {
  return `PeanutGallery${name}`;
}

const DEFAULT_HANDLER_CODE = `
exports.handler = async () => {
  console.log('default handler not yet overwritten');
};
`;
