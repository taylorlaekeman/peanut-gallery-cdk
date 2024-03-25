import * as cdk from "aws-cdk-lib";
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

    const graphqlLambdaS3 = new s3.Bucket(this, getName("GraphQLLambdaBucket"));

    const graphqlLambda = new lambda.Function(this, getName("GraphQLLambda"), {
      code: lambda.Code.fromBucket(
        graphqlLambdaS3,
        getName("GraphQLLambdaCode")
      ),
      handler: 'index.main',
      runtime: lambda.Runtime.NODEJS_18_X,
    });
  }
}

function getName(name: string): string {
  return `PeanutGallery${name}`;
}
