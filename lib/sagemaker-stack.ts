import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sagemaker from 'aws-cdk-lib/aws-sagemaker';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export class SagemakerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, `SageMakerBucket`, {
      bucketName: `sagemaker-bucket-${uuidv4()}`,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const bucketFullAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:*'],
      resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
    });

    const vpc = new ec2.Vpc(this, `SageMakerVpc`, {
      subnetConfiguration: [
        {
          name: `SageMakerPublicSubnet`,
          cidrMask: 24,
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: `SageMakerPrivateSubnet`,
          cidrMask: 24,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });
    const sg = new ec2.SecurityGroup(this, `SageMakerSecurityGroup`, {
      vpc,
      securityGroupName: `SageMakerSecurityGroup`,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22));
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    const role = new iam.Role(this, `SageMakerRole`, {
      assumedBy: new iam.ServicePrincipal(`sagemaker.amazonaws.com`),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName(`AmazonSageMakerFullAccess`)],
    });
    role.addToPolicy(bucketFullAccessPolicy);

    const script = fs.readFileSync('./scripts/auto-stop.sh', 'utf-8');
    const config = new sagemaker.CfnNotebookInstanceLifecycleConfig(
      this,
      `notebookLifecycleConfig`,
      {
        notebookInstanceLifecycleConfigName: 'auto-stop',
        onStart: [
          {
            content: Buffer.from(script).toString('base64'),
          },
        ],
      }
    );

    const notebook = new sagemaker.CfnNotebookInstance(this, `notebook`, {
      notebookInstanceName: `SageMakerNotebookInstance`,
      instanceType: `ml.t3.medium`,
      roleArn: role.roleArn,
      platformIdentifier: `notebook-al2-v2`,
      subnetId: vpc.isolatedSubnets[0].subnetId,
      securityGroupIds: [sg.securityGroupId],
      lifecycleConfigName: config.notebookInstanceLifecycleConfigName,
      defaultCodeRepository: process.env.NOTEBOOK_GIT_REPO,
    });
  }
}
